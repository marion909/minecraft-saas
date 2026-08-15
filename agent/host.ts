/**
 * Der Host selbst — Zustand ablesen und ihn neu starten.
 *
 * Alles Lesende hier läuft unprivilegiert: /proc und statfs stehen jedem
 * offen. Nur das Aus- und Einschalten verlangt root, und dafür gibt es
 * denselben Weg wie beim Speicher — ein eng gefasstes Skript hinter einer
 * sudo-Regel, statt den ganzen Agent zu erheben. Siehe deploy/mc-host-helper.
 */
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);

export const HOST_HELPER = "/usr/local/sbin/mc-host-helper";

export type PowerMode = "reboot" | "poweroff";

export type HostInfo = {
  hostname: string;
  kernel: string;
  uptimeSeconds: number;
  cpuCount: number;
  /** 1, 5 und 15 Minuten. Auf Systemen ohne Lastmittel drei Nullen. */
  loadAverage: [number, number, number];
  memory: { totalMb: number; availableMb: number; source: "meminfo" | "os" };
  disk: { path: string; totalMb: number; freeMb: number } | null;
  rebootRequired: { required: boolean; packages: string[] };
  /** Darf dieser Prozess den Host wirklich schalten? Gemessen, nicht geraten. */
  canPower: boolean;
  powerError: string | null;
};

/**
 * Liest MemTotal und MemAvailable aus /proc/meminfo.
 *
 * MemAvailable statt MemFree ist der Punkt: Unter Linux zählt der
 * Seitencache als belegt, MemFree ist auf einem eingelaufenen Server
 * deshalb immer klein und sagt nichts über den tatsächlich verfügbaren
 * Speicher. Der Kernel rechnet MemAvailable selbst aus.
 *
 * Gibt null zurück, wenn das Format nicht passt — dann wird auf die
 * Werte von node:os zurückgefallen, statt eine erfundene Zahl anzuzeigen.
 */
export function parseMeminfo(
  text: string,
): { totalKb: number; availableKb: number } | null {
  const field = (name: string): number | null => {
    // Feldname am Zeilenanfang, Doppelpunkt, Leerraum, Zahl, Einheit.
    const match = new RegExp(`^${name}:\\s+(\\d+)\\s*kB$`, "m").exec(text);
    return match?.[1] ? Number(match[1]) : null;
  };

  const totalKb = field("MemTotal");
  const availableKb = field("MemAvailable");

  if (totalKb === null || availableKb === null) return null;
  return { totalKb, availableKb };
}

/**
 * Ubuntu legt diese Datei an, wenn ein Paket einen Neustart verlangt —
 * fast immer ein Kernel. Sie ist der einzige belastbare Grund, einen
 * laufenden Spielserver-Host überhaupt neu zu starten, und gehört deshalb
 * in die Anzeige.
 */
export async function readRebootRequired(): Promise<{
  required: boolean;
  packages: string[];
}> {
  try {
    await fsPromises.access("/var/run/reboot-required");
  } catch {
    return { required: false, packages: [] };
  }

  const packages = await fsPromises
    .readFile("/var/run/reboot-required.pkgs", "utf8")
    .then((text) =>
      [...new Set(text.split("\n").map((line) => line.trim()))].filter(Boolean),
    )
    .catch(() => []);

  return { required: true, packages };
}

/**
 * Fragt sudo, ob der Helfer aufgerufen werden dürfte — ohne ihn aufzurufen.
 *
 * `sudo -n -l <befehl>` prüft genau die Regel und schlägt ohne
 * NOPASSWD-Eintrag fehl, statt nach einem Passwort zu fragen. Damit kann
 * das Panel den Knopf schon abschalten, bevor jemand ihn drückt und in
 * einen Fehler läuft.
 */
export async function canPower(): Promise<{ ok: boolean; error: string | null }> {
  try {
    await run("sudo", ["-n", "-l", HOST_HELPER], { timeout: 5000 });
    return { ok: true, error: null };
  } catch (error) {
    // Zwei verschiedene Ursachen mit derselben Wirkung: Die Datei fehlt,
    // oder sie ist nicht freigegeben. Wer das nicht auseinanderhält,
    // sucht an der falschen Stelle — deshalb wird hier nachgesehen,
    // statt beides in einen Satz zu werfen.
    const vorhanden = await fsPromises
      .access(HOST_HELPER, fsConstants.X_OK)
      .then(() => true)
      .catch(() => false);

    if (!vorhanden) {
      return {
        ok: false,
        error:
          `${HOST_HELPER} liegt nicht dort oder ist nicht ausführbar. ` +
          `Installiert wird er von deploy/setup.sh und deploy/update.sh.`,
      };
    }

    // Die eigentliche sudo-Meldung steht in stderr, nicht in message —
    // dort steht nur "Command failed", was niemandem weiterhilft.
    // Schweigt sudo ganz, gibt es für diesen Befehl schlicht keine Regel.
    const stderr = String(
      (error as { stderr?: unknown }).stderr ?? "",
    ).trim();

    return {
      ok: false,
      error:
        `Der Helfer liegt bereit, aber sudo lässt ihn nicht durch` +
        (stderr ? ` (${stderr.split("\n")[0]})` : "") +
        `. In /etc/sudoers.d/mc-agent fehlt die Zeile für ` +
        `${HOST_HELPER} — bei einer Installation von vor der ` +
        `Host-Steuerung steht dort nur der ZFS-Helfer. Ergänzt wird sie ` +
        `von deploy/update.sh.`,
    };
  }
}

export async function collectHostInfo(dataRoot: string): Promise<HostInfo> {
  const [meminfoText, rebootRequired, power] = await Promise.all([
    fsPromises.readFile("/proc/meminfo", "utf8").catch(() => null),
    readRebootRequired(),
    canPower(),
  ]);

  const meminfo = meminfoText ? parseMeminfo(meminfoText) : null;

  const memory = meminfo
    ? {
        totalMb: Math.round(meminfo.totalKb / 1024),
        availableMb: Math.round(meminfo.availableKb / 1024),
        source: "meminfo" as const,
      }
    : {
        // Auf macOS (Entwicklung) gibt es kein /proc. os.freemem() ist unter
        // Linux die schlechtere Zahl, hier aber die einzige.
        totalMb: Math.round(os.totalmem() / 1024 / 1024),
        availableMb: Math.round(os.freemem() / 1024 / 1024),
        source: "os" as const,
      };

  const disk = await fsPromises
    .statfs(dataRoot)
    .then((stats) => ({
      path: dataRoot,
      totalMb: Math.round((stats.blocks * stats.bsize) / 1024 / 1024),
      // bavail, nicht bfree: Der für gewöhnliche Prozesse nutzbare Platz.
      freeMb: Math.round((stats.bavail * stats.bsize) / 1024 / 1024),
    }))
    .catch(() => null);

  const [one, five, fifteen] = os.loadavg();

  return {
    hostname: os.hostname(),
    kernel: `${os.type()} ${os.release()}`,
    uptimeSeconds: Math.round(os.uptime()),
    cpuCount: os.cpus().length,
    loadAverage: [one ?? 0, five ?? 0, fifteen ?? 0],
    memory,
    disk,
    rebootRequired,
    canPower: power.ok,
    powerError: power.error,
  };
}

/**
 * Schaltet den Host. Kehrt im Erfolgsfall nicht zurück — systemd beendet
 * diesen Prozess mitten im Aufruf. Ein Timeout-Fehler danach ist deshalb
 * kein Fehler, sondern das erwartete Ende.
 */
export async function powerHost(mode: PowerMode): Promise<void> {
  try {
    await run("sudo", ["-n", HOST_HELPER, mode], { timeout: 30_000 });
  } catch (error) {
    const detail =
      error instanceof Error && error.message ? error.message : String(error);

    throw new Error(
      `${HOST_HELPER} ${mode} fehlgeschlagen: ${detail} — ` +
        `liegt der Helfer dort und erlaubt /etc/sudoers.d/mc-agent ihn?`,
    );
  }
}
