import { ServerStatus } from "@/generated/prisma/enums";

/**
 * Zustände werden mit Worten benannt, die ein Spieler versteht — nicht mit
 * dem Enum-Namen aus der Datenbank. Die Tönung kodiert dieselbe Information
 * noch einmal, damit sie im Überflug erkennbar ist.
 */
export const STATUS_LABEL: Record<ServerStatus, string> = {
  [ServerStatus.PROVISIONING]: "wird eingerichtet",
  [ServerStatus.STOPPED]: "gestoppt",
  [ServerStatus.STARTING]: "startet",
  [ServerStatus.RUNNING]: "läuft",
  [ServerStatus.STOPPING]: "stoppt",
  [ServerStatus.SUSPENDED]: "gesperrt",
  [ServerStatus.DELETING]: "wird gelöscht",
  [ServerStatus.FAILED]: "Fehler",
};

export type StatusTone = "ok" | "busy" | "off" | "bad";

export const STATUS_TONE: Record<ServerStatus, StatusTone> = {
  [ServerStatus.PROVISIONING]: "busy",
  [ServerStatus.STOPPED]: "off",
  [ServerStatus.STARTING]: "busy",
  [ServerStatus.RUNNING]: "ok",
  [ServerStatus.STOPPING]: "busy",
  [ServerStatus.SUSPENDED]: "bad",
  [ServerStatus.DELETING]: "busy",
  [ServerStatus.FAILED]: "bad",
};

/**
 * Megabyte lesbar machen. Die Ressourcenfelder rechnen durchweg in MB,
 * aber „900000 MB“ liest niemand als 900 GB.
 */
export function formatMb(mb: number): string {
  if (mb < 1024) return `${Math.round(mb)} MB`;
  if (mb < 1024 * 1024) {
    const gb = mb / 1024;
    return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
  }
  return `${(mb / 1024 / 1024).toFixed(1)} TB`;
}

/** Laufzeit als „3 Tage, 4 Std.“ — Sekunden interessieren hier niemanden. */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days} ${days === 1 ? "Tag" : "Tage"}, ${hours} Std.`;
  if (hours > 0) return `${hours} Std., ${minutes} Min.`;
  return `${minutes} Min.`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
