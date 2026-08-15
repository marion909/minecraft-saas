"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ServerStatus, ServerType } from "@/generated/prisma/enums";
import { AgentClient, AgentError } from "@/lib/agent";
import { audit } from "@/lib/audit";
import { computeCapacity, fits } from "@/lib/capacity";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { requireUser } from "@/lib/session";
import { checkSubdomain } from "@/lib/subdomain";

export type ServerFormState = {
  error?: string;
  fields?: Record<string, string>;
  output?: string;
};

const SERVER_TYPES = Object.values(ServerType);

/**
 * Lädt den Server und stellt sicher, dass er dem angemeldeten Nutzer gehört.
 * Ohne diese Prüfung an *jeder* Aktion wäre die Server-ID in der URL eine
 * Fernsteuerung für fremde Server.
 */
async function loadOwnServer(serverId: string) {
  const session = await requireUser();

  const server = await db.server.findUnique({
    where: { id: serverId },
    include: { node: true, plan: true },
  });

  // Bewusst dieselbe Meldung in beiden Fällen: Wer nicht Eigentümer ist,
  // soll nicht erfahren, dass die ID überhaupt existiert.
  if (!server) throw new Error("Diesen Server gibt es nicht.");
  if (server.userId !== session.user.id && !isAdmin(session.user.role)) {
    throw new Error("Diesen Server gibt es nicht.");
  }

  return { session, server };
}

export async function createServer(
  _previous: ServerFormState,
  formData: FormData,
): Promise<ServerFormState> {
  const session = await requireUser();

  const name = String(formData.get("name") ?? "").trim();
  const planId = String(formData.get("planId") ?? "");
  const serverType = String(formData.get("serverType") ?? "");
  const mcVersion = String(formData.get("mcVersion") ?? "").trim() || "LATEST";

  const fields: Record<string, string> = {};

  if (name.length < 2 || name.length > 40) {
    fields.name = "Zwischen 2 und 40 Zeichen.";
  }

  const subdomain = checkSubdomain(String(formData.get("subdomain") ?? ""));
  if (!subdomain.ok) fields.subdomain = subdomain.reason;

  if (!SERVER_TYPES.includes(serverType as ServerType)) {
    fields.serverType = "Unbekannte Server-Software.";
  }

  const plan = await db.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    fields.planId = "Diesen Tarif gibt es nicht.";
  } else if (!plan.isPublic && !isAdmin(session.user.role)) {
    fields.planId = "Dieser Tarif ist nicht buchbar.";
  }

  if (Object.keys(fields).length > 0 || !plan || !subdomain.ok) {
    return { fields };
  }

  const taken = await db.server.findUnique({
    where: { subdomain: subdomain.value },
  });
  if (taken) {
    return { fields: { subdomain: "Diese Adresse ist schon vergeben." } };
  }

  const owned = await db.server.count({ where: { userId: session.user.id } });
  if (owned >= plan.maxServers && !isAdmin(session.user.role)) {
    return {
      error: `Der Tarif „${plan.name}“ erlaubt ${plan.maxServers} Server; du hast bereits ${owned}.`,
    };
  }

  const node = await db.node.findFirst({
    where: { status: "ONLINE" },
    include: { servers: true },
  });
  if (!node) {
    return { error: "Kein Node verfügbar. Bitte später erneut versuchen." };
  }

  const allocated = node.servers.reduce(
    (sum, entry) => ({
      memoryMb: sum.memoryMb + entry.appliedMemoryMb,
      cpuCores: sum.cpuCores + entry.appliedCpuCores,
      diskMb: sum.diskMb + entry.appliedDiskMb,
    }),
    { memoryMb: 0, cpuCores: 0, diskMb: 0 },
  );

  const room = fits(computeCapacity(node, allocated), {
    memoryMb: plan.memoryMb,
    cpuCores: plan.cpuCores,
    diskMb: plan.diskMb,
  });

  if (!room.ok) {
    return {
      error: `Auf dem Node ist gerade kein Platz für diesen Tarif. ${room.reason}`,
    };
  }

  // Bleibt serverseitig — das Panel schickt Befehle, nie Zugangsdaten.
  const rconPassword = randomBytes(24).toString("base64url");

  const server = await db.server.create({
    data: {
      name,
      subdomain: subdomain.value,
      serverType: serverType as ServerType,
      mcVersion,
      status: ServerStatus.PROVISIONING,
      rconPassword,
      appliedMemoryMb: plan.memoryMb,
      appliedCpuCores: plan.cpuCores,
      appliedDiskMb: plan.diskMb,
      userId: session.user.id,
      nodeId: node.id,
      planId: plan.id,
    },
  });

  const hostname = `${subdomain.value}.${node.publicHost}`;

  try {
    const { task } = await AgentClient.forNode(node).createServer({
      serverId: server.id,
      subdomain: subdomain.value,
      serverType,
      mcVersion,
      memoryMb: plan.memoryMb,
      cpuCores: plan.cpuCores,
      diskMb: plan.diskMb,
      maxPlayers: plan.maxPlayers,
      rconPassword,
      hostname,
    });

    // Merken, damit der Abgleich später fragen kann, ob das Anlegen
    // durchgelaufen ist — der Agent arbeitet asynchron.
    await db.server.update({
      where: { id: server.id },
      data: { lastTaskId: task.id },
    });
  } catch (error) {
    // Der Datenbankeintrag existiert schon; ohne diese Korrektur bliebe er
    // für immer auf PROVISIONING stehen und würde Kapazität blockieren.
    await db.server.update({
      where: { id: server.id },
      data: {
        status: ServerStatus.FAILED,
        lastError:
          error instanceof AgentError
            ? error.message
            : "Agent-Aufruf fehlgeschlagen.",
      },
    });

    return {
      error:
        error instanceof AgentError
          ? `Der Server konnte nicht angelegt werden: ${error.message}`
          : "Der Server konnte nicht angelegt werden.",
    };
  }

  await audit({
    action: "server.created",
    userId: session.user.id,
    serverId: server.id,
    meta: { plan: plan.slug, hostname, serverType, mcVersion },
  });

  revalidatePath("/dashboard");
  redirect(`/servers/${server.id}`);
}

async function runAction(
  serverId: string,
  action: "start" | "stop" | "restart",
): Promise<ServerFormState> {
  const { session, server } = await loadOwnServer(serverId);
  const agent = AgentClient.forNode(server.node);

  if (server.status === ServerStatus.SUSPENDED) {
    return { error: "Dieser Server ist gesperrt." };
  }

  try {
    if (action === "start") await agent.start(server.id, server.rconPassword);
    if (action === "stop") await agent.stop(server.id, server.rconPassword);
    if (action === "restart")
      await agent.restart(server.id, server.rconPassword);
  } catch (error) {
    return {
      error:
        error instanceof AgentError
          ? error.message
          : "Der Vorgang konnte nicht gestartet werden.",
    };
  }

  await db.server.update({
    where: { id: server.id },
    data: {
      status: action === "stop" ? ServerStatus.STOPPING : ServerStatus.STARTING,
      lastError: null,
    },
  });

  await audit({
    action: `server.${action}`,
    userId: session.user.id,
    serverId: server.id,
  });

  revalidatePath(`/servers/${server.id}`);
  revalidatePath("/dashboard");
  return {};
}

export async function startServer(
  _previous: ServerFormState,
  formData: FormData,
): Promise<ServerFormState> {
  return runAction(String(formData.get("serverId") ?? ""), "start");
}

export async function stopServer(
  _previous: ServerFormState,
  formData: FormData,
): Promise<ServerFormState> {
  return runAction(String(formData.get("serverId") ?? ""), "stop");
}

export async function restartServer(
  _previous: ServerFormState,
  formData: FormData,
): Promise<ServerFormState> {
  return runAction(String(formData.get("serverId") ?? ""), "restart");
}

export async function deleteServer(
  _previous: ServerFormState,
  formData: FormData,
): Promise<ServerFormState> {
  const serverId = String(formData.get("serverId") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "").trim();

  const { session, server } = await loadOwnServer(serverId);

  // Der Name muss abgetippt werden. Das ist der einzige Schutz davor, eine
  // Welt aus Versehen zu löschen — danach gibt es kein Zurück.
  if (confirmation !== server.name) {
    return {
      fields: { confirmation: "Der eingegebene Name stimmt nicht überein." },
    };
  }

  await db.server.update({
    where: { id: server.id },
    data: { status: ServerStatus.DELETING },
  });

  try {
    await AgentClient.forNode(server.node).remove(
      server.id,
      server.rconPassword,
    );
  } catch (error) {
    await db.server.update({
      where: { id: server.id },
      data: {
        status: ServerStatus.FAILED,
        lastError:
          error instanceof AgentError
            ? error.message
            : "Löschen fehlgeschlagen.",
      },
    });
    return {
      error:
        error instanceof AgentError
          ? `Löschen fehlgeschlagen: ${error.message}`
          : "Löschen fehlgeschlagen.",
    };
  }

  await audit({
    action: "server.deleted",
    userId: session.user.id,
    meta: {
      serverId: server.id,
      name: server.name,
      subdomain: server.subdomain,
    },
  });

  await db.server.delete({ where: { id: server.id } });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function sendCommand(
  _previous: ServerFormState,
  formData: FormData,
): Promise<ServerFormState> {
  const serverId = String(formData.get("serverId") ?? "");
  const command = String(formData.get("command") ?? "").trim();

  if (!command) return { fields: { command: "Kein Befehl eingegeben." } };

  const { session, server } = await loadOwnServer(serverId);

  // stop und restart über die Konsole würden den Status im Panel
  // auseinanderlaufen lassen — dafür gibt es die Schaltflächen.
  const head = command.split(/\s+/)[0]?.toLowerCase();
  if (head === "stop" || head === "restart") {
    return {
      fields: {
        command: `„${head}“ bitte über die Schaltflächen — sonst weiß das Panel nicht Bescheid.`,
      },
    };
  }

  try {
    const { output } = await AgentClient.forNode(server.node).command(
      server.id,
      server.rconPassword,
      command,
    );

    await audit({
      action: "server.command",
      userId: session.user.id,
      serverId: server.id,
      meta: { command },
    });

    return { output: output || "(keine Ausgabe)" };
  } catch (error) {
    return {
      error:
        error instanceof AgentError
          ? error.message
          : "Befehl konnte nicht ausgeführt werden.",
    };
  }
}
