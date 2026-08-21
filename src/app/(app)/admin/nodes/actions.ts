"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { AgentClient, AgentError } from "@/lib/agent";
import { audit } from "@/lib/audit";
import { computeCapacity } from "@/lib/capacity";
import { db } from "@/lib/db";
import { fieldErrors, nodeInputFromForm } from "@/lib/node-schema";
import { requireAdmin } from "@/lib/session";

export type NodeFormState = {
  error?: string;
  fields?: Record<string, string>;
};

/**
 * Was ein Node an Ressourcen bereits vergeben hat.
 *
 * Zählt die tatsächlich am Container anliegenden Werte, nicht die des
 * Tarifs: Ein Server, der noch mit den alten Grenzen läuft, belegt auch
 * die alten.
 */
async function allocationOf(nodeId: string) {
  const servers = await db.server.findMany({
    where: { nodeId },
    select: { appliedMemoryMb: true, appliedCpuCores: true, appliedDiskMb: true },
  });

  return servers.reduce(
    (sum, server) => ({
      memoryMb: sum.memoryMb + server.appliedMemoryMb,
      cpuCores: sum.cpuCores + server.appliedCpuCores,
      diskMb: sum.diskMb + server.appliedDiskMb,
    }),
    { memoryMb: 0, cpuCores: 0, diskMb: 0 },
  );
}

export type NodeProbe =
  | {
      state: "ok";
      storage: "zfs" | "directory";
      hardQuota: boolean;
      network: string;
      dockerOk: boolean;
      dockerError: string | null;
    }
  | { state: "fehler"; reason: string };

/**
 * Fragt einen Agent, bevor er gespeichert wird.
 *
 * Ohne diesen Knopf merkt man einen Tippfehler in Adresse oder Token
 * erst, wenn der erste Nutzer einen Server anlegt und einen Fehler
 * bekommt, der nach seinem Fehler aussieht.
 *
 * Die Adresse kommt aus dem Formular, es geht also eine Anfrage an ein
 * frei gewähltes Ziel. Das ist hier vertretbar: Nur Admins kommen
 * hierher, und die legen ohnehin Nodes an. Zurück gegeben wird
 * ausschließlich, was /health liefert — kein durchgereichter Rumpf.
 */
export async function probeAgent(
  agentUrl: string,
  agentToken: string,
  nodeId: string | null,
): Promise<NodeProbe> {
  await requireAdmin();

  let token = agentToken.trim();

  // Beim Bearbeiten bleibt das Feld leer, wenn das Token unverändert ist.
  // Dann den gespeicherten nehmen, statt den Test scheitern zu lassen.
  if (!token && nodeId) {
    const node = await db.node.findUnique({
      where: { id: nodeId },
      select: { agentToken: true },
    });
    token = node?.agentToken ?? "";
  }

  if (!agentUrl.trim() || !token) {
    return { state: "fehler", reason: "Adresse und Token werden beide gebraucht." };
  }

  try {
    const health = await new AgentClient(agentUrl.trim(), token).health();

    return {
      state: "ok",
      storage: health.storage.kind,
      hardQuota: health.storage.hardQuota,
      network: health.network,
      dockerOk: health.docker?.ok ?? true,
      dockerError: health.docker?.error ?? null,
    };
  } catch (error) {
    return {
      state: "fehler",
      reason:
        error instanceof AgentError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Unbekannter Fehler.",
    };
  }
}

export async function createNode(
  _previous: NodeFormState,
  formData: FormData,
): Promise<NodeFormState> {
  const session = await requireAdmin();
  const parsed = nodeInputFromForm(formData);

  if (!parsed.success) {
    return { fields: fieldErrors(parsed.error) };
  }

  // Beim Anlegen gibt es kein gespeichertes Token, auf das man
  // zurückfallen könnte.
  if (!parsed.data.agentToken) {
    return { fields: { agentToken: "Ohne Token kommt das Panel nicht an den Agent." } };
  }

  const clash = await db.node.findUnique({ where: { name: parsed.data.name } });
  if (clash) {
    return { fields: { name: "Diesen Namen gibt es schon." } };
  }

  const node = await db.node.create({ data: parsed.data });

  await audit({
    action: "node.created",
    userId: session.user.id,
    meta: {
      nodeId: node.id,
      name: node.name,
      baseDomain: node.baseDomain,
      agentUrl: node.agentUrl,
    },
  });

  revalidatePath("/admin/nodes");
  redirect(`/admin/nodes/${node.id}`);
}

export async function updateNode(
  nodeId: string,
  _previous: NodeFormState,
  formData: FormData,
): Promise<NodeFormState> {
  const session = await requireAdmin();
  const parsed = nodeInputFromForm(formData);

  if (!parsed.success) {
    return { fields: fieldErrors(parsed.error) };
  }

  const before = await db.node.findUnique({ where: { id: nodeId } });
  if (!before) {
    return { error: "Diesen Node gibt es nicht mehr." };
  }

  const clash = await db.node.findFirst({
    where: { id: { not: nodeId }, name: parsed.data.name },
  });
  if (clash) {
    return { fields: { name: "Diesen Namen gibt es schon." } };
  }

  // Grenzen unter das bereits Vergebene zu setzen, ist fast immer ein
  // Tippfehler — 8192 statt 81920. Ginge es durch, liefe der Node ab
  // sofort überbucht, und das fällt erst beim OOM-Kill auf. Wer wirklich
  // Hardware ausgebaut hat, räumt vorher Server ab.
  const allocated = await allocationOf(nodeId);
  const capacity = computeCapacity(parsed.data, allocated);
  const fields: Record<string, string> = {};

  if (capacity.memoryMb.capacity < allocated.memoryMb) {
    fields.totalMemoryMb =
      `Auf diesem Node sind bereits ${allocated.memoryMb} MB vergeben; ` +
      `nach Abzug der Reserve blieben nur ${capacity.memoryMb.capacity} MB.`;
  }

  if (capacity.diskMb.capacity < allocated.diskMb) {
    fields.totalDiskMb =
      `Auf diesem Node sind bereits ${allocated.diskMb} MB vergeben; ` +
      `nach Abzug der Reserve blieben nur ${capacity.diskMb.capacity} MB.`;
  }

  if (capacity.cpuCores.capacity < allocated.cpuCores) {
    fields.totalCpuCores =
      `Auf diesem Node sind bereits ${allocated.cpuCores} Kerne vergeben; ` +
      `mit dieser Überbuchung blieben nur ${capacity.cpuCores.capacity}.`;
  }

  if (Object.keys(fields).length > 0) {
    return { fields };
  }

  const { agentToken, ...rest } = parsed.data;

  await db.node.update({
    where: { id: nodeId },
    // Leeres Tokenfeld heißt "unverändert" — sonst müsste man das Token
    // zum Ändern einer Zahl erneut heraussuchen und irgendwo ablegen.
    data: agentToken ? { ...rest, agentToken } : rest,
  });

  await audit({
    action: "node.updated",
    userId: session.user.id,
    meta: {
      nodeId,
      name: parsed.data.name,
      tokenChanged: Boolean(agentToken),
      statusBefore: before.status,
      statusAfter: parsed.data.status,
      memoryMbBefore: before.totalMemoryMb,
      memoryMbAfter: parsed.data.totalMemoryMb,
    },
  });

  revalidatePath("/admin/nodes");
  revalidatePath(`/admin/nodes/${nodeId}`);
  redirect("/admin/nodes");
}

/**
 * Zustand umschalten, ohne das ganze Formular zu öffnen.
 *
 * DRAINING ist der eigentlich nützliche Zustand: Der Node nimmt keine
 * neuen Server mehr an, die vorhandenen laufen weiter. Genau das braucht
 * man vor einem Neustart oder einem Umzug.
 */
export async function setNodeStatus(
  _previous: NodeFormState,
  formData: FormData,
): Promise<NodeFormState> {
  const session = await requireAdmin();
  const nodeId = String(formData.get("nodeId") ?? "");
  const status = String(formData.get("status") ?? "");

  if (status !== "ONLINE" && status !== "DRAINING" && status !== "OFFLINE") {
    return { error: "Unbekannter Zustand." };
  }

  const node = await db.node.findUnique({ where: { id: nodeId } });
  if (!node) {
    return { error: "Diesen Node gibt es nicht mehr." };
  }

  await db.node.update({ where: { id: nodeId }, data: { status } });

  await audit({
    action: "node.status.changed",
    userId: session.user.id,
    meta: { nodeId, name: node.name, from: node.status, to: status },
  });

  revalidatePath("/admin/nodes");
  revalidatePath("/admin/host");
  return {};
}

export async function deleteNode(
  _previous: NodeFormState,
  formData: FormData,
): Promise<NodeFormState> {
  const session = await requireAdmin();
  const nodeId = String(formData.get("nodeId") ?? "");

  const node = await db.node.findUnique({
    where: { id: nodeId },
    include: { _count: { select: { servers: true } } },
  });

  if (!node) {
    return { error: "Diesen Node gibt es nicht mehr." };
  }

  // Der Fremdschlüssel steht auf Restrict; die Datenbank lehnte ohnehin
  // ab. Hier abgefangen wird daraus ein Satz, der sagt, was zu tun ist.
  if (node._count.servers > 0) {
    return {
      error:
        `Auf „${node.name}“ liegen noch ${node._count.servers} Server. ` +
        `Setze den Node auf DRAINING, zieh die Server um oder lösche sie — ` +
        `den Eintrag hier zu entfernen, würde die Container auf dem Host ` +
        `zurücklassen, ohne dass das Panel noch von ihnen wüsste.`,
    };
  }

  await db.node.delete({ where: { id: nodeId } });

  await audit({
    action: "node.deleted",
    userId: session.user.id,
    meta: { nodeId, name: node.name, baseDomain: node.baseDomain },
  });

  revalidatePath("/admin/nodes");
  redirect("/admin/nodes");
}
