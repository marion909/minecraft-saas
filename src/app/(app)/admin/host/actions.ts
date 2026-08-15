"use server";

import { revalidatePath } from "next/cache";

import { AgentClient, AgentError } from "@/lib/agent";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

export type HostPowerState = {
  error?: string;
  message?: string;
};

/**
 * Host neu starten oder ausschalten.
 *
 * Der Ablauf steckt bewusst im Agent und nicht hier: Das Anhalten der
 * Server dauert Minuten, und eine Server-Action, die so lange offen
 * bleibt, wird vom ersten Proxy dazwischen abgeschnitten. Diese Funktion
 * übergibt deshalb nur den Auftrag samt RCON-Passwörtern und kehrt
 * sofort zurück.
 *
 * Die Passwörter verlassen den Server dabei nicht: Panel und Agent
 * laufen auf derselben Maschine, die Verbindung geht über 127.0.0.1.
 */
export async function powerNode(
  _previous: HostPowerState,
  formData: FormData,
): Promise<HostPowerState> {
  const session = await requireAdmin();

  const nodeId = String(formData.get("nodeId") ?? "");
  const mode = String(formData.get("mode") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "").trim();

  if (mode !== "reboot" && mode !== "poweroff") {
    return { error: "Unbekannter Vorgang." };
  }

  const node = await db.node.findUnique({
    where: { id: nodeId },
    include: {
      servers: {
        select: { id: true, name: true, rconPassword: true, status: true },
      },
    },
  });

  if (!node) {
    return { error: "Diesen Node gibt es nicht mehr." };
  }

  // Der getippte Name ist die eigentliche Sicherung. Ein Bestätigungsdialog
  // wird weggeklickt, ohne gelesen zu werden; einen Namen abzutippen
  // verlangt, dass man hinsieht, welcher Host gemeint ist.
  if (confirmation !== node.name) {
    return {
      error: `Zum Bestätigen „${node.name}“ eintippen — genau so, wie der Node heißt.`,
    };
  }

  const agent = AgentClient.forNode(node);

  try {
    const result = await agent.power(
      mode,
      // Alle mitgeben: Welche davon wirklich laufen, stellt der Agent
      // selbst fest. Er braucht zu jedem das Passwort, sonst kann er die
      // Welt nicht speichern lassen, bevor er den Container stoppt.
      node.servers.map((server) => ({
        serverId: server.id,
        rconPassword: server.rconPassword,
      })),
    );

    await audit({
      action: mode === "reboot" ? "node.rebooted" : "node.powered.off",
      userId: session.user.id,
      meta: {
        nodeId: node.id,
        name: node.name,
        taskId: result.task.id,
        servers: result.servers,
      },
    });

    revalidatePath("/admin/host");

    return {
      message:
        mode === "reboot"
          ? `Neustart angestoßen. Der Agent hält ${result.servers} Server an und startet den Host danach neu — das dauert einige Minuten, in denen auch dieses Panel nicht erreichbar ist.`
          : `Herunterfahren angestoßen. Der Agent hält ${result.servers} Server an und schaltet den Host danach ab. Zum Wiedereinschalten musst du an die Maschine.`,
    };
  } catch (error) {
    return {
      error:
        error instanceof AgentError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Der Agent hat den Auftrag nicht angenommen.",
    };
  }
}
