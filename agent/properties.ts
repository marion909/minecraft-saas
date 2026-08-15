import { PROTECTED_PROPERTIES } from "./paths.ts";

/**
 * server.properties ist ein Java-Properties-Format: `schlüssel=wert` je
 * Zeile, `#` leitet Kommentare ein. Bewusst zeilenweise bearbeitet statt
 * neu geschrieben — so bleiben Kommentare und Reihenfolge erhalten, und
 * unbekannte Einstellungen gehen nicht verloren.
 */

export type PropertyEntry = { key: string; value: string };

export function parseProperties(text: string): PropertyEntry[] {
  const entries: PropertyEntry[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    entries.push({
      key: trimmed.slice(0, separator).trim(),
      value: trimmed.slice(separator + 1),
    });
  }

  return entries;
}

export type ApplyResult = {
  text: string;
  changed: string[];
  rejected: string[];
};

/**
 * Setzt Werte, ohne die Datei neu zu schreiben.
 *
 * Geschützte Schlüssel werden abgewiesen statt still ignoriert: Wer
 * `enable-rcon` abschalten oder `rcon.password` ändern kann, nimmt dem
 * Panel die Steuerung über seinen eigenen Server — und wer `server-port`
 * verstellt, macht ihn für mc-router unerreichbar.
 */
export function applyProperties(
  text: string,
  updates: Record<string, string>,
): ApplyResult {
  const changed: string[] = [];
  const rejected: string[] = [];
  const remaining = new Map<string, string>();

  for (const [key, value] of Object.entries(updates)) {
    if (PROTECTED_PROPERTIES.has(key)) {
      rejected.push(key);
      continue;
    }
    remaining.set(key, value);
  }

  const lines = text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
      return line;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) return line;

    const key = trimmed.slice(0, separator).trim();
    if (!remaining.has(key)) return line;

    const value = remaining.get(key)!;
    remaining.delete(key);
    changed.push(key);
    return `${key}=${value}`;
  });

  // Was in der Datei noch nicht stand, kommt hinten dazu.
  for (const [key, value] of remaining) {
    lines.push(`${key}=${value}`);
    changed.push(key);
  }

  return { text: lines.join("\n"), changed, rejected };
}

/**
 * Einstellungen, die das Panel geführt anbietet. Alles andere bleibt über
 * den Dateimanager erreichbar — hier stehen die, die Spieler tatsächlich
 * ändern wollen.
 */
export type PropertySpec = {
  key: string;
  label: string;
  type: "text" | "boolean" | "number" | "select";
  options?: string[];
  hint?: string;
};

export const GUIDED_PROPERTIES: PropertySpec[] = [
  { key: "motd", label: "Beschreibung", type: "text", hint: "Was in der Serverliste steht." },
  {
    key: "difficulty",
    label: "Schwierigkeit",
    type: "select",
    options: ["peaceful", "easy", "normal", "hard"],
  },
  {
    key: "gamemode",
    label: "Spielmodus",
    type: "select",
    options: ["survival", "creative", "adventure", "spectator"],
  },
  { key: "pvp", label: "PvP erlaubt", type: "boolean" },
  { key: "white-list", label: "Nur Whitelist", type: "boolean", hint: "Nur eingetragene Spieler dürfen verbinden." },
  { key: "online-mode", label: "Mojang-Konto nötig", type: "boolean", hint: "Ausschalten öffnet den Server für Raubkopien — und für Namensbetrug." },
  { key: "hardcore", label: "Hardcore", type: "boolean" },
  { key: "allow-flight", label: "Fliegen erlaubt", type: "boolean" },
  { key: "spawn-protection", label: "Spawn-Schutz (Blöcke)", type: "number" },
  { key: "view-distance", label: "Sichtweite (Chunks)", type: "number", hint: "Höhere Werte kosten spürbar CPU und Arbeitsspeicher." },
  { key: "simulation-distance", label: "Simulationsweite (Chunks)", type: "number" },
  { key: "enable-command-block", label: "Befehlsblöcke", type: "boolean" },
];
