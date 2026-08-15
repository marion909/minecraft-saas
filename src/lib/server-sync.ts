import { ServerStatus } from "@/generated/prisma/enums";
import type { Node, Server } from "@/generated/prisma/client";

import { AgentClient, AgentError, type AgentServerState } from "./agent";
import { db } from "./db";
import { mapAgentStatus } from "./server-status-map";

/**
 * Der wahre Zustand steht in Docker, nicht in der Datenbank. Die Spalte
 * `status` ist ein Zwischenspeicher fürs Anzeigen — hier wird sie mit der
 * Wirklichkeit abgeglichen.
 */

export { mapAgentStatus } from "./server-status-map";

export type SyncedServer = {
  status: ServerStatus;
  ready: boolean;
  usedBytes: number | null;
  agentReachable: boolean;
  agentError: string | null;
};

/**
 * Holt den Zustand beim Agent und schreibt ihn in die Datenbank zurück.
 * Ist der Agent nicht erreichbar, bleibt der letzte bekannte Stand stehen
 * und wird als solcher gekennzeichnet — besser als eine Anzeige, die
 * behauptet, alles sei kaputt, weil ein Dienst neu startet.
 */
export async function syncServer(
  server: Server & { node: Node },
): Promise<SyncedServer> {
  const agent = AgentClient.forNode(server.node);

  let state: AgentServerState;
  try {
    state = await agent.getServer(server.id);
  } catch (error) {
    return {
      status: server.status,
      ready: server.status === ServerStatus.RUNNING,
      usedBytes: null,
      agentReachable: false,
      agentError:
        error instanceof AgentError ? error.message : "Agent nicht erreichbar.",
    };
  }

  let status = mapAgentStatus(state, server.status);
  let lastError: string | null = server.lastError;

  // Bleibt es beim Anlegen, muss der Vorgang selbst befragt werden. Sonst
  // stünde ein gescheiterter Image-Pull für immer als "wird eingerichtet"
  // da und würde Kapazität blockieren, die es nie gab.
  if (status === ServerStatus.PROVISIONING && server.lastTaskId) {
    try {
      const task = await agent.getTask(server.lastTaskId);

      if (task.status === "failed") {
        status = ServerStatus.FAILED;
        lastError = task.error ?? "Der Server konnte nicht angelegt werden.";
      }
    } catch {
      // Der Agent kennt den Vorgang nicht mehr — Tasks liegen nur im
      // Speicher und sind nach einem Neustart weg. Dann entscheidet
      // ausschließlich, ob der Container da ist.
      if (state.status === "absent") {
        status = ServerStatus.FAILED;
        lastError =
          "Das Anlegen wurde unterbrochen und lässt sich nicht mehr nachvollziehen.";
      }
    }
  }

  if (
    status !== server.status ||
    state.containerId !== server.containerId ||
    lastError !== server.lastError
  ) {
    await db.server.update({
      where: { id: server.id },
      data: { status, containerId: state.containerId, lastError },
    });
  }

  return {
    status,
    ready: state.ready,
    usedBytes: state.usage?.usedBytes ?? null,
    agentReachable: true,
    agentError: null,
  };
}
