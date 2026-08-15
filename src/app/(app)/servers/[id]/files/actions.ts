"use server";

import { revalidatePath } from "next/cache";

import { AgentClient, AgentError } from "@/lib/agent";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export type FileFormState = {
  error?: string;
  saved?: boolean;
  restartRequired?: boolean;
  rejected?: string[];
};

/** Wie in den Server-Aktionen: Ohne Eigentumsprüfung wäre die ID eine Fernsteuerung. */
async function loadOwnServer(serverId: string) {
  const session = await requireUser();

  const server = await db.server.findUnique({
    where: { id: serverId },
    include: { node: true },
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

export async function saveFile(
  _previous: FileFormState,
  formData: FormData,
): Promise<FileFormState> {
  const serverId = String(formData.get("serverId") ?? "");
  const path = String(formData.get("path") ?? "");
  const content = String(formData.get("content") ?? "");

  const { session, server } = await loadOwnServer(serverId);

  try {
    await AgentClient.forNode(server.node).writeFile(server.id, path, content);
  } catch (error) {
    return { error: message(error, "Datei konnte nicht gespeichert werden.") };
  }

  await audit({
    action: "server.file.write",
    userId: session.user.id,
    serverId: server.id,
    meta: { path, bytes: content.length },
  });

  revalidatePath(`/servers/${serverId}/files`);
  return { saved: true, restartRequired: true };
}

export async function deleteFile(
  _previous: FileFormState,
  formData: FormData,
): Promise<FileFormState> {
  const serverId = String(formData.get("serverId") ?? "");
  const path = String(formData.get("path") ?? "");

  const { session, server } = await loadOwnServer(serverId);

  try {
    await AgentClient.forNode(server.node).deleteFile(server.id, path);
  } catch (error) {
    return { error: message(error, "Löschen fehlgeschlagen.") };
  }

  await audit({
    action: "server.file.delete",
    userId: session.user.id,
    serverId: server.id,
    meta: { path },
  });

  revalidatePath(`/servers/${serverId}/files`);
  return { saved: true };
}

export async function createDirectory(
  _previous: FileFormState,
  formData: FormData,
): Promise<FileFormState> {
  const serverId = String(formData.get("serverId") ?? "");
  const path = String(formData.get("path") ?? "");

  const { session, server } = await loadOwnServer(serverId);

  try {
    await AgentClient.forNode(server.node).makeDirectory(server.id, path);
  } catch (error) {
    return { error: message(error, "Ordner konnte nicht angelegt werden.") };
  }

  await audit({
    action: "server.file.mkdir",
    userId: session.user.id,
    serverId: server.id,
    meta: { path },
  });

  revalidatePath(`/servers/${serverId}/files`);
  return { saved: true };
}

export async function saveProperties(
  _previous: FileFormState,
  formData: FormData,
): Promise<FileFormState> {
  const serverId = String(formData.get("serverId") ?? "");
  const { session, server } = await loadOwnServer(serverId);

  const updates: Record<string, string> = {};

  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("prop.")) continue;
    updates[name.slice(5)] = String(value);
  }

  // Checkboxen tauchen nur auf, wenn sie gesetzt sind — die abgewählten
  // müssen ausdrücklich auf false gesetzt werden.
  for (const name of String(formData.get("booleanKeys") ?? "")
    .split(",")
    .filter(Boolean)) {
    if (updates[name] === undefined) updates[name] = "false";
  }

  if (Object.keys(updates).length === 0) {
    return { error: "Nichts zu speichern." };
  }

  try {
    const result = await AgentClient.forNode(server.node).updateProperties(
      server.id,
      updates,
    );

    await audit({
      action: "server.properties.update",
      userId: session.user.id,
      serverId: server.id,
      meta: { changed: result.changed, rejected: result.rejected },
    });

    revalidatePath(`/servers/${serverId}/settings`);
    return {
      saved: true,
      restartRequired: result.restartRequired,
      rejected: result.rejected,
    };
  } catch (error) {
    return {
      error: message(error, "Einstellungen konnten nicht gespeichert werden."),
    };
  }
}
