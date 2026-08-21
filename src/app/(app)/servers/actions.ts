"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ServerStatus, ServerType } from "@/generated/prisma/enums";
import { AgentClient, AgentError } from "@/lib/agent";
import { audit } from "@/lib/audit";
import { placeServer } from "@/lib/capacity";
import {
  DEFAULT_GAME,
  findGame,
  serverAddress,
  serverHostname,
} from "@/lib/games";
import { allocatePort, blockSize, portsOf } from "@/lib/ports";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { checkServerName } from "@/lib/server-name";
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

/**
 * Rückmeldung, während getippt wird.
 *
 * Bewusst dieselben Prüfungen wie beim Anlegen, nur ohne Nebenwirkung —
 * und ohne Anspruch auf Endgültigkeit: Zwischen der Antwort hier und dem
 * Abschicken kann jemand anders dieselbe Adresse belegen. Deshalb prüft
 * createServer erneut, und diese Funktion darf sich irren, ohne Schaden
 * anzurichten.
 */
export type Availability =
  | { state: "frei" }
  | { state: "belegt"; reason: string }
  | { state: "ungültig"; reason: string };

export async function checkNameAvailable(input: string): Promise<Availability> {
  const session = await requireUser();

  const parsed = checkServerName(input);
  if (!parsed.ok) return { state: "ungültig", reason: parsed.reason };

  // Nur die eigenen Server: Der Name steht bloß im Panel, und wie fremde
  // Leute ihre Server nennen, geht niemanden etwas an — die Prüfung soll
  // auch nicht verraten, dass es sie gibt.
  const existing = await db.server.findFirst({
    where: {
      userId: session.user.id,
      name: { equals: parsed.value, mode: "insensitive" },
    },
    select: { id: true },
  });

  return existing
    ? { state: "belegt", reason: "So heißt schon einer deiner Server." }
    : { state: "frei" };
}

export async function checkAddressAvailable(
  input: string,
): Promise<Availability> {
  await requireUser();

  const parsed = checkSubdomain(input);
  if (!parsed.ok) return { state: "ungültig", reason: parsed.reason };

  const existing = await db.server.findUnique({
    where: { subdomain: parsed.value },
    select: { id: true },
  });

  return existing
    ? { state: "belegt", reason: "Diese Adresse ist schon vergeben." }
    : { state: "frei" };
}

/**
 * Wie die Adresse am Ende aussieht — für die Vorschau, während getippt
 * wird. Das Spielsegment und die Basis kommen vom Node, den Port kennt
 * erst das Anlegen; hier steht deshalb der Standardport des Spiels.
 */
export async function previewAddress(
  gameId: string,
  subdomain: string,
): Promise<{ address: string; routing: "hostname" | "port" } | null> {
  await requireUser();

  const game = findGame(gameId);
  if (!game) return null;

  const node = await db.node.findFirst({
    where: { status: "ONLINE" },
    select: { baseDomain: true },
  });

  const basis = node?.baseDomain || "example.com";
  const name = subdomain.trim().toLowerCase() || "deinserver";

  return {
    address: serverAddress(game, name, basis, null),
    routing: game.routing,
  };
}

export async function createServer(
  _previous: ServerFormState,
  formData: FormData,
): Promise<ServerFormState> {
  const session = await requireUser();

  const planId = String(formData.get("planId") ?? "");
  const gameId = String(formData.get("game") ?? "").trim() || DEFAULT_GAME;
  const serverType = String(formData.get("serverType") ?? "");
  const mcVersion = String(formData.get("mcVersion") ?? "").trim() || "LATEST";

  const fields: Record<string, string> = {};

  const game = findGame(gameId);
  if (!game) fields.game = "Dieses Spiel gibt es nicht.";

  const parsedName = checkServerName(String(formData.get("name") ?? ""));
  if (!parsedName.ok) fields.name = parsedName.reason;

  const subdomain = checkSubdomain(String(formData.get("subdomain") ?? ""));
  if (!subdomain.ok) fields.subdomain = subdomain.reason;

  // Die Variante gibt es nur bei Spielen, die welche kennen — bei
  // Minecraft Paper, Vanilla und so weiter. Für Valheim wäre die Frage
  // sinnlos, und ein Pflichtfeld dafür würde das Anlegen blockieren.
  if (game?.variants && !SERVER_TYPES.includes(serverType as ServerType)) {
    fields.serverType = "Unbekannte Server-Software.";
  }

  const plan = await db.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    fields.planId = "Diesen Tarif gibt es nicht.";
  } else if (!plan.isPublic && !isAdmin(session.user.role)) {
    fields.planId = "Dieser Tarif ist nicht buchbar.";
  } else if (game && plan.memoryMb < game.minMemoryMb) {
    // Lieber hier ablehnen als den Server anlegen und zusehen, wie er
    // beim Start am Arbeitsspeicher scheitert.
    fields.planId =
      `${game.name} braucht mindestens ${game.minMemoryMb} MB, ` +
      `„${plan.name}“ bietet ${plan.memoryMb} MB.`;
  } else if (game && plan.diskMb < game.installMb) {
    fields.planId =
      `${game.name} belegt allein für die Installation rund ` +
      `${Math.round(game.installMb / 1024)} GB, „${plan.name}“ hat ` +
      `${Math.round(plan.diskMb / 1024)} GB.`;
  }

  if (
    Object.keys(fields).length > 0 ||
    !plan ||
    !game ||
    !subdomain.ok ||
    !parsedName.ok
  ) {
    return { fields };
  }

  const name = parsedName.value;

  // Dieselben zwei Prüfungen laufen schon währenddes Tippens über
  // checkNameAvailable/checkAddressAvailable. Hier stehen sie trotzdem:
  // Zwischen der letzten Prüfung im Browser und dem Abschicken liegt Zeit,
  // und die Bedingung kann sich darin ändern.
  const nameTaken = await db.server.findFirst({
    where: { userId: session.user.id, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (nameTaken) {
    return { fields: { name: "So heißt schon einer deiner Server." } };
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

  // Alle betriebsbereiten Nodes, nicht nur den ersten: Sonst wäre ein
  // zweiter Node wirkungslos, sobald der erste voll ist. DRAINING und
  // OFFLINE bleiben außen vor — genau dafür gibt es die Zustände.
  const candidates = await db.node.findMany({
    where: { status: "ONLINE" },
    include: {
      servers: {
        select: {
          appliedMemoryMb: true,
          appliedCpuCores: true,
          appliedDiskMb: true,
        },
      },
    },
  });

  const placement = placeServer(
    candidates.map((candidate) => ({
      node: candidate,
      allocated: candidate.servers.reduce(
        (sum, entry) => ({
          memoryMb: sum.memoryMb + entry.appliedMemoryMb,
          cpuCores: sum.cpuCores + entry.appliedCpuCores,
          diskMb: sum.diskMb + entry.appliedDiskMb,
        }),
        { memoryMb: 0, cpuCores: 0, diskMb: 0 },
      ),
    })),
    { memoryMb: plan.memoryMb, cpuCores: plan.cpuCores, diskMb: plan.diskMb },
  );

  if (!placement.ok) {
    return {
      error: `Gerade ist kein Platz für diesen Tarif. ${placement.reason}`,
    };
  }

  const node = placement.node;

  // Minecraft braucht keinen eigenen Port: Alle Server hängen an 25565,
  // mc-router verteilt sie am Hostnamen aus dem Handshake. Jedes andere
  // Spiel kennt kein solches Feld im Protokoll — dort unterscheidet nur
  // der Port, also bekommt jeder Server einen eigenen.
  let port: number | null = null;

  if (game.routing === "port") {
    const vergeben = await db.server.findMany({
      where: { nodeId: node.id, port: { not: null } },
      select: { port: true, game: true },
    });

    // Nicht nur den zugeteilten Port sperren, sondern den ganzen Block:
    // Valheim belegt zwei aufeinanderfolgende, Rust ebenso. Wer nur den
    // ersten zählt, vergibt den zweiten ein zweites Mal.
    const belegt = vergeben.flatMap((eintrag) => {
      const anderes = findGame(eintrag.game);
      return anderes && eintrag.port !== null
        ? portsOf(anderes, eintrag.port)
        : [];
    });

    const zuteilung = allocatePort(
      belegt,
      { start: node.portRangeStart, end: node.portRangeEnd },
      blockSize(game),
    );

    if (!zuteilung.ok) {
      return { error: `Kein freier Port auf diesem Node. ${zuteilung.reason}` };
    }

    port = zuteilung.port;
  }

  // Bleibt serverseitig — das Panel schickt Befehle, nie Zugangsdaten.
  const rconPassword = randomBytes(24).toString("base64url");

  let server;

  try {
    server = await db.server.create({
      data: {
        name,
        game: game.id,
        port,
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
  } catch (error) {
    // Zwischen der Portsuche oben und diesem Schreiben kann jemand
    // anders denselben genommen haben. Die Datenbank fängt das ab; hier
    // wird daraus ein Satz statt eines Constraint-Fehlers.
    const meldung = error instanceof Error ? error.message : String(error);

    if (meldung.includes("nodeId") && meldung.includes("port")) {
      return {
        error:
          "Der Port wurde gerade von einem anderen Server belegt. " +
          "Bitte noch einmal versuchen.",
      };
    }
    throw error;
  }

  const hostname = serverHostname(game, subdomain.value, node.baseDomain);

  try {
    const { task } = await AgentClient.forNode(node).createServer({
      serverId: server.id,
      game: game.id,
      port,
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
    meta: { plan: plan.slug, game: game.id, hostname, port, serverType, mcVersion },
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
