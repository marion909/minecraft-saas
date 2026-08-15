/**
 * Minecraft-Versionen vergleichen.
 *
 * Liegt hier und nicht im Agent, weil beide Seiten es brauchen: Der Agent
 * leitet daraus das passende Java-Image ab, das Panel warnt damit vor
 * Rückstufungen.
 */

export type ParsedVersion =
  | { kind: "legacy"; minor: number; patch: number }
  | { kind: "modern"; major: number; minor: number }
  | { kind: "unknown" };

export function parseVersion(version: string): ParsedVersion {
  const trimmed = version.trim();

  // "LATEST", "SNAPSHOT" und Ähnliches lassen sich nicht zuordnen.
  if (!/^\d/.test(trimmed)) return { kind: "unknown" };

  const parts = trimmed.split(".");
  const first = Number(parts[0]);

  if (!Number.isFinite(first)) return { kind: "unknown" };

  // Altes Schema: 1.20.4, 1.21.8 — die zweite Zahl trägt die Bedeutung.
  if (first === 1) {
    const minor = Number(parts[1]);
    if (!Number.isFinite(minor)) return { kind: "unknown" };

    const patch = Number(parts[2]);
    return { kind: "legacy", minor, patch: Number.isFinite(patch) ? patch : 0 };
  }

  // Neues Schema ab 2026: 26.1 und aufwärts.
  const minor = Number(parts[1]);
  return {
    kind: "modern",
    major: first,
    minor: Number.isFinite(minor) ? minor : 0,
  };
}

/**
 * Negativ = a älter als b, 0 = gleich, positiv = a neuer.
 * `null` heißt: nicht vergleichbar, weil eine Seite ein Platzhalter ist.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);

  if (left.kind === "unknown" || right.kind === "unknown") return null;

  // Das neue Schema löst das alte ab, ist also grundsätzlich neuer.
  if (left.kind !== right.kind) return left.kind === "modern" ? 1 : -1;

  if (left.kind === "legacy" && right.kind === "legacy") {
    return left.minor - right.minor || left.patch - right.patch;
  }
  if (left.kind === "modern" && right.kind === "modern") {
    return left.major - right.major || left.minor - right.minor;
  }
  return 0;
}

/**
 * Ist der Wechsel eine Rückstufung?
 *
 * Das ist die gefährliche Richtung: Minecraft wandelt die Welt beim
 * Hochstufen um und schreibt eine höhere `DataVersion` in `level.dat`.
 * Ein älterer Server weigert sich dann zu starten oder lädt die Welt
 * fehlerhaft. Zurück führt kein unterstützter Weg.
 *
 * `null` heißt: lässt sich nicht feststellen, etwa bei LATEST. Dann muss
 * die Warnung vorsichtshalber erscheinen.
 */
export function isDowngrade(from: string, to: string): boolean | null {
  const result = compareVersions(to, from);
  return result === null ? null : result < 0;
}

/**
 * Wechsel der Server-Software, die Mods oder Plugins unbrauchbar machen.
 * Die Dateien bleiben liegen, werden aber nicht mehr geladen — oder
 * schlimmer: vom neuen Loader falsch interpretiert.
 */
export function softwareSwitchWarning(
  from: string,
  to: string,
): string | null {
  if (from === to) return null;

  const modLoaders = new Set(["FABRIC", "FORGE"]);
  const pluginServers = new Set(["PAPER", "PURPUR"]);

  if (modLoaders.has(from) && modLoaders.has(to)) {
    return `Mods für ${from} laufen nicht unter ${to}. Der Inhalt von mods/ muss ausgetauscht werden, sonst startet der Server nicht.`;
  }
  if (modLoaders.has(from) && !modLoaders.has(to)) {
    return `${to} lädt keine ${from}-Mods. Die Welt kann Blöcke enthalten, die es danach nicht mehr gibt.`;
  }
  if (!modLoaders.has(from) && modLoaders.has(to)) {
    return `${to} braucht passende Mods in mods/. Ohne sie startet der Server zwar, verhält sich aber wie Vanilla.`;
  }
  if (pluginServers.has(from) && to === "VANILLA") {
    return "Vanilla lädt keine Plugins. Alles, was ein Plugin in der Welt angelegt hat, bleibt liegen, funktioniert aber nicht mehr.";
  }

  return null;
}
