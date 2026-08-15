/**
 * Welches itzg-Image passt zu welcher Minecraft-Version?
 *
 * Minecraft hebt regelmäßig seine Java-Mindestanforderung an. Passt das
 * Image nicht, startet der Server nicht — er stirbt mit
 * "requires running the server with Java NN or above" und landet dank
 * Restart-Policy in einer Schleife. Das ist der häufigste Startfehler
 * überhaupt und gehört deshalb hier abgefangen, nicht in die Fehlersuche.
 */

import { parseVersion } from "../src/lib/mc-version.ts";

// Der Vergleich selbst liegt in src/lib, weil auch das Panel ihn braucht.
export {
  compareVersions,
  isDowngrade,
  parseVersion,
  type ParsedVersion,
} from "../src/lib/mc-version.ts";

export const IMAGE_REPO = "itzg/minecraft-server";

/** Neuester unterstützter Stand; auch die Vorgabe für Unbekanntes. */
export const NEWEST_JAVA = 25;

type Rule = {
  /** Gilt ab dieser Version (einschließlich), im alten 1.x-Schema. */
  minLegacyMinor: number;
  java: number;
};

/**
 * Altes Schema (1.x). Aufsteigend geprüft, die letzte passende Regel gewinnt.
 * Quelle sind die Java-Anforderungen der jeweiligen Server-Releases.
 */
const LEGACY_RULES: Rule[] = [
  { minLegacyMinor: 0, java: 8 },
  { minLegacyMinor: 17, java: 17 },
  { minLegacyMinor: 21, java: 21 },
];

export function javaForVersion(version: string): number {
  const parsed = parseVersion(version);

  if (parsed.kind === "legacy") {
    let java = LEGACY_RULES[0]?.java ?? 8;
    for (const rule of LEGACY_RULES) {
      if (parsed.minor >= rule.minLegacyMinor) java = rule.java;
    }
    return java;
  }

  // Neues Schema und alles Unbekannte (LATEST, SNAPSHOT) bekommen das
  // neueste Java. Bei LATEST ist das die einzig sichere Wahl: Die Version
  // steht erst beim Start fest, und zu altes Java lässt den Server
  // gar nicht erst hochkommen.
  return NEWEST_JAVA;
}

export function imageForVersion(version: string, repo = IMAGE_REPO): string {
  return `${repo}:java${javaForVersion(version)}`;
}
