import fs from "node:fs/promises";
import path from "node:path";

/**
 * Pfad-Auflösung für den Dateimanager.
 *
 * Das ist die Stelle, an der Hosting-Panels reihenweise aufgebrochen werden.
 * Zwei Dinge müssen zusammenkommen:
 *
 *   1. `..` und absolute Pfade dürfen nicht aus dem Serververzeichnis führen.
 *   2. Symlinks müssen VOR der Prüfung aufgelöst werden. Ein Nutzer kann im
 *      Container `ln -s / /data/raus` anlegen; ohne realpath folgt der Agent
 *      dem Link mit seinen eigenen Rechten und liefert das Wirtssystem aus.
 *
 * Die Auflösung endet am tiefsten existierenden Vorfahren, damit auch das
 * Anlegen neuer Dateien geprüft werden kann.
 */

export class PathViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathViolation";
  }
}

/** Entfernt alles, was den Pfad aus dem Wurzelverzeichnis führen könnte. */
export function normalizeRelative(input: string): string {
  if (input.includes("\0")) {
    // Ein Nullbyte kann in C-basierten Schichten den Pfad abschneiden.
    throw new PathViolation("Pfad enthält ein Nullbyte.");
  }

  // Führende Trenner entfernen, sonst macht path.resolve daraus einen
  // absoluten Pfad und ignoriert die Wurzel vollständig.
  const withoutRoot = input.replace(/^[/\\]+/, "");
  const normalized = path.normalize(withoutRoot);

  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new PathViolation("Pfad führt aus dem Serververzeichnis heraus.");
  }

  return normalized === "." ? "" : normalized;
}

/** Liegt `candidate` innerhalb von `root`? Beide müssen aufgelöst sein. */
export function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

export type ResolvedPath = {
  /** Vollständiger Pfad auf dem Host. */
  absolute: string;
  /** Pfad relativ zur Serverwurzel, für die Anzeige. */
  relative: string;
  exists: boolean;
};

/**
 * Löst einen Nutzerpfad gegen die Serverwurzel auf und stellt sicher, dass
 * er darin bleibt — auch über Symlinks hinweg.
 */
export async function safeResolve(
  root: string,
  userPath: string,
): Promise<ResolvedPath> {
  const relative = normalizeRelative(userPath);

  // Auch die Wurzel selbst kann ein Symlink sein; sonst schlägt der
  // Präfixvergleich später fälschlich fehl.
  const realRoot = await fs.realpath(root);
  const target = path.resolve(realRoot, relative);

  // Der tiefste existierende Vorfahre wird aufgelöst, der fehlende Rest
  // danach wieder angehängt. So lassen sich auch neue Dateien prüfen.
  const missing: string[] = [];
  let probe = target;

  for (;;) {
    try {
      const realProbe = await fs.realpath(probe);
      const absolute = path.join(realProbe, ...missing.reverse());

      if (!isInside(realRoot, absolute)) {
        throw new PathViolation(
          "Pfad führt aus dem Serververzeichnis heraus.",
        );
      }

      return {
        absolute,
        relative: path.relative(realRoot, absolute),
        exists: missing.length === 0,
      };
    } catch (error) {
      if (error instanceof PathViolation) throw error;

      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;

      const parent = path.dirname(probe);
      if (parent === probe) {
        throw new PathViolation("Pfad lässt sich nicht auflösen.");
      }

      missing.push(path.basename(probe));
      probe = parent;
    }
  }
}

/**
 * Dateien, die der Nutzer nicht anfassen darf. Nicht aus Prüderie: Wer
 * eula.txt oder server.properties frei überschreibt, kann den Server
 * unstartbar machen oder RCON umkonfigurieren und sich damit selbst
 * die Fernsteuerung öffnen.
 */
export const PROTECTED_FILES = new Set(["eula.txt"]);

/** Einstellungen, die das Panel setzt und die nicht überschrieben werden dürfen. */
export const PROTECTED_PROPERTIES = new Set([
  "enable-rcon",
  "rcon.password",
  "rcon.port",
  "server-port",
  "query.port",
  "broadcast-rcon-to-ops",
]);

export function isProtected(relative: string): boolean {
  return PROTECTED_FILES.has(relative.replace(/\\/g, "/"));
}
