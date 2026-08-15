"use server";

import { revalidatePath } from "next/cache";

import { ServerStatus } from "@/generated/prisma/enums";
import { AgentClient, AgentError } from "@/lib/agent";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export type BackupFormState = {
  error?: string;
  info?: string;
};

async function loadOwnServer(serverId: string) {
  const session = await requireUser();

  const server = await db.server.findUnique({
    where: { id: serverId },
    include: { node: true, plan: true },
  });

  if (!server) throw new Error("Diesen Server gibt es nicht.");
  if (server.userId !== session.user.id && !isAdmin(session.user.role)) {
    throw new Error("Diesen Server gibt es nicht.");
  }

  return { session, server };
}

function message(error: unknown, fallback: string): string {
  return error instanceof AgentError ? error.message : fallback;
}

export async function createBackup(
  _previous: BackupFormState,
  formData: FormData,
): Promise<BackupFormState> {
  const serverId = String(formData.get("serverId") ?? "");
  const { session, server } = await loadOwnServer(serverId);

  try {
    const { label } = await AgentClient.forNode(server.node).createBackup(
      server.id,
      server.rconPassword,
      // Rotation gehört zum Tarif: Der Agent kennt ihn nicht, das Panel schon.
      server.plan.maxBackups,
    );

    await db.backup.create({
      data: { serverId: server.id, snapshotName: label, status: "PENDING" },
    });

    await audit({
      action: "backup.create",
      userId: session.user.id,
      serverId: server.id,
      meta: { label, keep: server.plan.maxBackups },
    });

    revalidatePath(`/servers/${serverId}/backups`);
    return { info: "Backup läuft. Der Server bleibt dabei erreichbar." };
  } catch (error) {
    return { error: message(error, "Backup konnte nicht gestartet werden.") };
  }
}

export async function restoreBackup(
  _previous: BackupFormState,
  formData: FormData,
): Promise<BackupFormState> {
  const serverId = String(formData.get("serverId") ?? "");
  const label = String(formData.get("label") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "").trim();

  const { session, server } = await loadOwnServer(serverId);

  // Zurückspielen verwirft alles seit dem Backup. Das muss ausdrücklich
  // bestätigt werden — es gibt danach kein Zurück zum aktuellen Stand.
  if (confirmation !== server.name) {
    return {
      error: `Bitte den Servernamen „${server.name}“ eingeben, um das Zurückspielen zu bestätigen.`,
    };
  }

  try {
    await AgentClient.forNode(server.node).restoreBackup(
      server.id,
      server.rconPassword,
      label,
    );

    await db.server.update({
      where: { id: server.id },
      data: { status: ServerStatus.STOPPING, lastError: null },
    });

    await audit({
      action: "backup.restore",
      userId: session.user.id,
      serverId: server.id,
      meta: { label },
    });

    revalidatePath(`/servers/${serverId}`);
    revalidatePath(`/servers/${serverId}/backups`);
    return {
      info: "Der Server wird gestoppt, zurückgespielt und wieder gestartet.",
    };
  } catch (error) {
    return { error: message(error, "Zurückspielen fehlgeschlagen.") };
  }
}

export async function deleteBackup(
  _previous: BackupFormState,
  formData: FormData,
): Promise<BackupFormState> {
  const serverId = String(formData.get("serverId") ?? "");
  const label = String(formData.get("label") ?? "");

  const { session, server } = await loadOwnServer(serverId);

  try {
    await AgentClient.forNode(server.node).deleteBackup(server.id, label);

    await db.backup.deleteMany({
      where: { serverId: server.id, snapshotName: label },
    });

    await audit({
      action: "backup.delete",
      userId: session.user.id,
      serverId: server.id,
      meta: { label },
    });

    revalidatePath(`/servers/${serverId}/backups`);
    return { info: "Backup entfernt." };
  } catch (error) {
    return { error: message(error, "Backup konnte nicht entfernt werden.") };
  }
}
