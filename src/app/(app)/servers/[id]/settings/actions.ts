"use server";

import { revalidatePath } from "next/cache";

import { ServerStatus, ServerType } from "@/generated/prisma/enums";
import { AgentClient, AgentError } from "@/lib/agent";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { findGame } from "@/lib/games";
import { isDowngrade } from "@/lib/mc-version";
import { isAdmin } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export type VersionFormState = {
  error?: string;
  info?: string;
};

const SERVER_TYPES = Object.values(ServerType);

export async function changeVersion(
  _previous: VersionFormState,
  formData: FormData,
): Promise<VersionFormState> {
  const session = await requireUser();
  const serverId = String(formData.get("serverId") ?? "");

  const server = await db.server.findUnique({
    where: { id: serverId },
    include: { node: true, plan: true },
  });

  if (
    !server ||
    (server.userId !== session.user.id && !isAdmin(session.user.role))
  ) {
    return { error: "Diesen Server gibt es nicht." };
  }

  // Der Weg dahinter ist Minecraft: recreate im Agent baut den Container
  // ohne Spiel und ohne Port neu. Bei einem CS2-Server käme ein
  // Minecraft-Container heraus, ohne veröffentlichten Port. Das Formular
  // wird für diese Spiele gar nicht erst angezeigt; hier steht die Sperre
  // trotzdem, weil ein abgeschicktes Formular nichts beweist.
  const spiel = findGame(server.game);
  if (!spiel?.variants) {
    return {
      error:
        `Version und Software lassen sich bei ${spiel?.name ?? "diesem Spiel"} ` +
        `noch nicht umstellen.`,
    };
  }

  const mcVersion = String(formData.get("mcVersion") ?? "").trim() || "LATEST";
  const serverType = String(formData.get("serverType") ?? "");
  const acknowledged = formData.get("acknowledged") === "on";

  if (!SERVER_TYPES.includes(serverType as ServerType)) {
    return { error: "Unbekannte Server-Software." };
  }

  if (mcVersion === server.mcVersion && serverType === server.serverType) {
    return { error: "Es hat sich nichts geändert." };
  }

  // Rückstufungen und Software-Wechsel können die Welt unbrauchbar machen.
  // Beides muss ausdrücklich bestätigt werden, nicht nur angeklickt.
  const downgrade = isDowngrade(server.mcVersion, mcVersion);
  const risky = downgrade !== false || serverType !== server.serverType;

  if (risky && !acknowledged) {
    return {
      error:
        "Bitte bestätige, dass du die Folgen für die Weltdaten verstanden hast.",
    };
  }

  const previous = { version: server.mcVersion, type: server.serverType };

  try {
    await AgentClient.forNode(server.node).recreate({
      serverId: server.id,
      game: server.game,
      port: server.port,
      subdomain: server.subdomain,
      serverType,
      mcVersion,
      memoryMb: server.appliedMemoryMb,
      cpuCores: server.appliedCpuCores,
      maxPlayers: server.plan.maxPlayers,
      rconPassword: server.rconPassword,
      start: true,
    });
  } catch (error) {
    return {
      error:
        error instanceof AgentError
          ? `Umstellung fehlgeschlagen: ${error.message}`
          : "Umstellung fehlgeschlagen.",
    };
  }

  await db.server.update({
    where: { id: server.id },
    data: {
      mcVersion,
      serverType: serverType as ServerType,
      status: ServerStatus.STARTING,
      lastError: null,
    },
  });

  await audit({
    action: "server.recreate",
    userId: session.user.id,
    serverId: server.id,
    meta: {
      from: previous,
      to: { version: mcVersion, type: serverType },
      downgrade,
    },
  });

  revalidatePath(`/servers/${serverId}`);
  revalidatePath(`/servers/${serverId}/settings`);

  return {
    info:
      "Der Container wird ersetzt und der Server neu gestartet. Die Weltdaten bleiben unangetastet.",
  };
}

/**
 * Setzt den Container neu auf, ohne die Daten anzufassen.
 *
 * Nötig, wenn sich am Bauplan etwas geändert hat, das nur beim Anlegen
 * gilt — veröffentlichte Ports zum Beispiel. Docker kann sie an einem
 * bestehenden Container nicht ändern, ein Neustart hilft also nicht.
 *
 * Der Unterschied zum Löschen und Neuanlegen ist der, auf den es
 * ankommt: Das Datenverzeichnis bleibt liegen. Bei Satisfactory sind das
 * fünfzehn Gigabyte, die sonst noch einmal über Steam kämen.
 */
export async function recreateContainer(
  _previous: VersionFormState,
  formData: FormData,
): Promise<VersionFormState> {
  const session = await requireUser();
  const serverId = String(formData.get("serverId") ?? "");

  const server = await db.server.findUnique({
    where: { id: serverId },
    include: { node: true, plan: true },
  });

  if (
    !server ||
    (server.userId !== session.user.id && !isAdmin(session.user.role))
  ) {
    return { error: "Diesen Server gibt es nicht." };
  }

  try {
    await AgentClient.forNode(server.node).recreate({
      serverId: server.id,
      game: server.game,
      port: server.port,
      subdomain: server.subdomain,
      serverType: server.serverType,
      mcVersion: server.mcVersion,
      memoryMb: server.appliedMemoryMb,
      cpuCores: server.appliedCpuCores,
      maxPlayers: server.plan.maxPlayers,
      rconPassword: server.rconPassword,
      start: true,
    });
  } catch (error) {
    return {
      error:
        error instanceof AgentError
          ? `Neu aufsetzen fehlgeschlagen: ${error.message}`
          : "Neu aufsetzen fehlgeschlagen.",
    };
  }

  await db.server.update({
    where: { id: server.id },
    data: { status: ServerStatus.STARTING, lastError: null },
  });

  await audit({
    action: "server.recreate",
    userId: session.user.id,
    serverId: server.id,
    meta: { grund: "container-erneuert", game: server.game, port: server.port },
  });

  revalidatePath(`/servers/${serverId}`);
  revalidatePath(`/servers/${serverId}/settings`);

  return {
    info:
      "Der Container wird neu aufgesetzt. Die Daten bleiben liegen; " +
      "bei Spielen, die ihre Dateien über Steam holen, kann der erste " +
      "Start trotzdem dauern.",
  };
}
