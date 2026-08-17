/**
 * Ein hochgeladenes Archiv in ein Serververzeichnis einspielen.
 *
 * Der gefährlichste Vorgang im ganzen Agent: Er löscht eine Welt und
 * ersetzt sie durch Daten, die von außen kommen. Deshalb die Reihenfolge
 * unten — jeder Schritt, der schiefgehen kann, passiert *bevor* etwas
 * gelöscht wird. Was danach kommt, ist nur noch Kopieren.
 */
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createGunzip } from "node:zlib";

import { checkEntries, TarScanner, type ArchiveLimits } from "./archive.ts";

const run = promisify(execFile);

/** Der Benutzer im itzg-Image. Alles unter /data muss ihm gehören. */
export const CONTAINER_UID = 1000;
export const CONTAINER_GID = 1000;

export class ArchiveRejected extends Error {
  readonly problems: { entry: string; reason: string }[];

  constructor(problems: { entry: string; reason: string }[]) {
    super(
      `Archiv abgelehnt: ${problems
        .map((problem) => `${problem.entry} — ${problem.reason}`)
        .join("; ")}`,
    );
    this.problems = problems;
  }
}

/**
 * Liest alle Header des Archivs, ohne es zu entpacken.
 *
 * Läuft über den Gunzip-Strom, hält also nie das ganze Archiv im
 * Speicher — ein Weltarchiv kann Gigabytes haben.
 */
export async function inspectArchive(archivePath: string): Promise<TarScanner> {
  const scanner = new TarScanner();

  await new Promise<void>((resolve, reject) => {
    const quelle = createReadStream(archivePath);
    const gunzip = createGunzip();

    quelle.on("error", reject);
    gunzip.on("error", (error: Error) =>
      reject(
        new Error(
          `Das ist kein gültiges .tar.gz (${error.message}). Erwartet wird ` +
            `ein Archiv, wie es der Herunterladen-Knopf erzeugt.`,
        ),
      ),
    );

    gunzip.on("data", (teil: Buffer) => scanner.push(teil));
    gunzip.on("end", () => resolve());

    quelle.pipe(gunzip);
  });

  return scanner;
}

/**
 * Prüft, ob in das Zielverzeichnis geschrieben werden kann — vor dem
 * Löschen.
 *
 * Der Einhängepunkt gehört dem Container-Benutzer, der Agent ist ein
 * anderer und kommt nur über CAP_DAC_OVERRIDE hinein. Fehlt die
 * Capability, scheitert erst das Entpacken — und dann ist die alte Welt
 * schon weg. Also lieber einmal vorher anfassen.
 */
export async function assertWritable(verzeichnis: string): Promise<void> {
  const probe = path.join(verzeichnis, `.schreibprobe-${process.pid}`);

  try {
    await fs.writeFile(probe, "");
    await fs.rm(probe, { force: true });
  } catch (error) {
    throw new Error(
      `In ${verzeichnis} lässt sich nicht schreiben ` +
        `(${error instanceof Error ? error.message : String(error)}). ` +
        `Das Verzeichnis gehört dem Container-Benutzer; der Agent braucht ` +
        `dafür CAP_DAC_OVERRIDE aus deploy/mc-agent.service.`,
    );
  }
}

/** Leert ein Verzeichnis, ohne es selbst zu entfernen. */
async function leeren(verzeichnis: string): Promise<void> {
  // Der Einhängepunkt selbst muss bleiben: Bei ZFS ist er das Dataset,
  // und ein `rm -rf` darauf würde den Bind-Mount des Containers ins
  // Leere zeigen lassen.
  const einträge = await fs.readdir(verzeichnis);

  for (const eintrag of einträge) {
    await fs.rm(path.join(verzeichnis, eintrag), {
      recursive: true,
      force: true,
    });
  }
}

export type ImportResult = {
  entries: number;
  totalBytes: number;
};

/**
 * Beurteilt ein Archiv, ohne irgendetwas anzufassen.
 *
 * Bewusst als eigener Schritt: Der Aufrufer führt ihn aus, *bevor* er
 * den Server anhält. Sonst stünde nach einem kaputten Archiv ein
 * gestoppter Server da, für nichts.
 */
export async function verifyArchive(
  archivePath: string,
  limits: ArchiveLimits,
): Promise<ImportResult> {
  const scanner = await inspectArchive(archivePath);
  const ergebnis = checkEntries(scanner.entries, limits);

  if (!ergebnis.ok) {
    throw new ArchiveRejected(ergebnis.problems);
  }

  return { entries: ergebnis.entries, totalBytes: ergebnis.totalBytes };
}

/**
 * Ersetzt den Inhalt des Verzeichnisses durch das Archiv. Der Server
 * muss dafür stehen, und das Archiv muss geprüft sein.
 *
 * Reihenfolge mit Absicht: erst die Schreibprobe, dann löschen, dann
 * entpacken. Wer zuerst löscht und dann an den Rechten scheitert, hat
 * eine leere Welt.
 */
export async function applyArchive(
  verzeichnis: string,
  archivePath: string,
  report: (line: string) => void = () => {},
): Promise<void> {
  await assertWritable(verzeichnis);

  report("Bisherigen Inhalt entfernen");
  await leeren(verzeichnis);

  report("Entpacken");
  await run("tar", [
    "-xzf",
    archivePath,
    "-C",
    verzeichnis,
    // Eigentümer und Rechte aus dem Archiv sind die des fremden Systems
    // und hier bedeutungslos. Ohne diese Flags versucht tar außerdem,
    // fremde UIDs zu setzen, und scheitert oder legt Dateien an, die
    // dem Container nicht gehören.
    "--no-same-owner",
    "--no-same-permissions",
  ]);
}

/**
 * Übereignet den Baum dem Container-Benutzer.
 *
 * Ohne das gehören die entpackten Dateien dem Agent, und der Server —
 * der als UID 1000 läuft — könnte seine eigene Welt nicht speichern.
 * Braucht CAP_CHOWN, das die Unit mitgibt.
 */
export async function chownRecursive(
  wurzel: string,
  uid: number,
  gid: number,
): Promise<void> {
  await fs.chown(wurzel, uid, gid);

  const einträge = await fs.readdir(wurzel, { withFileTypes: true });

  for (const eintrag of einträge) {
    const voll = path.join(wurzel, eintrag.name);

    if (eintrag.isDirectory()) {
      await chownRecursive(voll, uid, gid);
    } else {
      // lchown, nicht chown: Ein symbolischer Verweis würde sonst auf
      // sein Ziel wirken. Aus dem Archiv kommen zwar keine, aber der
      // Server selbst kann welche angelegt haben.
      await fs.lchown(voll, uid, gid).catch(() => {});
    }
  }
}
