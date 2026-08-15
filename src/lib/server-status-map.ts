import { ServerStatus } from "../generated/prisma/enums.ts";
import type { AgentServerState } from "./agent.ts";

/**
 * Bildet die Sicht des Agents auf den Zustand ab, den das Panel anzeigt.
 *
 * Bewusst in einer eigenen Datei mit relativen Importen: So lässt sich die
 * Regel ohne Datenbank, ohne Agent und ohne Bundler testen — und genau hier
 * saß der Fehler, der einen fertig angelegten Server für immer auf
 * "wird eingerichtet" stehen ließ.
 */
export function mapAgentStatus(
  agent: AgentServerState,
  current: ServerStatus,
): ServerStatus {
  // Sperren kennt nur das Panel; kein Zustand des Agents hebt sie auf.
  if (current === ServerStatus.SUSPENDED) return ServerStatus.SUSPENDED;

  // Anlegen und Löschen sind Übergänge, die das Panel angestoßen hat. Das
  // Anlegen endet, sobald der Container erscheint — solange er fehlt, ist
  // "absent" kein Fehler, sondern der erwartete Zwischenstand.
  if (current === ServerStatus.PROVISIONING && agent.status === "absent") {
    return ServerStatus.PROVISIONING;
  }
  if (current === ServerStatus.DELETING) {
    return ServerStatus.DELETING;
  }

  switch (agent.status) {
    case "running":
      return ServerStatus.RUNNING;
    case "starting":
      return ServerStatus.STARTING;
    case "stopping":
      return ServerStatus.STOPPING;
    case "created":
    case "stopped":
      return ServerStatus.STOPPED;
    case "failed":
      return ServerStatus.FAILED;
    case "absent":
      // Der Container ist weg, obwohl das Panel ihn erwartet. Das ist ein
      // echter Fehlerzustand und keine Übergangsphase.
      return ServerStatus.FAILED;
  }
}
