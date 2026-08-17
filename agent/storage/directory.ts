import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { SnapshotArchive, SnapshotInfo, Storage, Usage } from "./types.ts";

const run = promisify(execFile);

/**
 * Rückfall für Rechner ohne ZFS — im Wesentlichen der Entwicklungs-Mac.
 *
 * Wichtig und bewusst sichtbar: `hardQuota` ist false. Ein Server kann hier
 * seine Grenze überschreiten, ohne dass ihn etwas aufhält. Die gemeldete
 * Belegung stimmt, die Zusicherung fehlt. Für Produktion ist dieser Treiber
 * nicht gedacht; der Agent warnt beim Start, wenn er ihn benutzt.
 */
export class DirectoryStorage implements Storage {
  readonly kind = "directory" as const;
  readonly hardQuota = false;

  /** Weiche Grenzen, nur zur Anzeige und für Warnungen. */
  #quotas = new Map<string, number>();

  private readonly root: string;
  private readonly snapshotRoot: string;

  constructor(root: string, snapshotRoot: string) {
    this.root = root;
    this.snapshotRoot = snapshotRoot;
  }

  path(serverId: string): string {
    return path.join(this.root, `srv-${serverId}`);
  }

  #snapshotDir(serverId: string): string {
    return path.join(this.snapshotRoot, `srv-${serverId}`);
  }

  async create(serverId: string, quotaMb: number): Promise<string> {
    const target = this.path(serverId);
    await fs.mkdir(target, { recursive: true });
    // 0777, damit der Container-Nutzer (UID 1000) schreiben darf, ohne dass
    // wir auf dem Entwicklungsrechner chown mit root ausführen müssten.
    await fs.chmod(target, 0o777);
    this.#quotas.set(serverId, quotaMb);
    return target;
  }

  async setQuota(serverId: string, quotaMb: number): Promise<void> {
    this.#quotas.set(serverId, quotaMb);
  }

  async usage(serverId: string): Promise<Usage> {
    const quotaMb = this.#quotas.get(serverId);
    return {
      usedBytes: await directorySize(this.path(serverId)),
      quotaBytes: quotaMb === undefined ? null : quotaMb * 1024 * 1024,
    };
  }

  async exists(serverId: string): Promise<boolean> {
    try {
      const stat = await fs.stat(this.path(serverId));
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  async destroy(serverId: string): Promise<void> {
    await fs.rm(this.path(serverId), { recursive: true, force: true });
    await fs.rm(this.#snapshotDir(serverId), { recursive: true, force: true });
    this.#quotas.delete(serverId);
  }

  async snapshot(serverId: string, label: string): Promise<void> {
    const dir = this.#snapshotDir(serverId);
    await fs.mkdir(dir, { recursive: true });

    // Kein echter Snapshot: ein vollständiges Archiv. Langsam und ohne
    // Deduplizierung, aber es macht den Backup-Pfad hier testbar.
    await run("tar", [
      "-czf",
      path.join(dir, `${label}.tar.gz`),
      "-C",
      this.path(serverId),
      ".",
    ]);
  }

  async listSnapshots(serverId: string): Promise<SnapshotInfo[]> {
    const dir = this.#snapshotDir(serverId);

    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }

    const infos = await Promise.all(
      entries
        .filter((name) => name.endsWith(".tar.gz"))
        .map(async (name) => {
          const stat = await fs.stat(path.join(dir, name));
          return {
            label: name.replace(/\.tar\.gz$/, ""),
            createdAt: stat.mtime,
            usedBytes: stat.size,
          };
        }),
    );

    return infos.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  async rollback(serverId: string, label: string): Promise<void> {
    const archive = path.join(this.#snapshotDir(serverId), `${label}.tar.gz`);
    await fs.access(archive);

    const target = this.path(serverId);
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(target, { recursive: true });
    await fs.chmod(target, 0o777);
    await run("tar", ["-xzf", archive, "-C", target]);
  }

  async destroySnapshot(serverId: string, label: string): Promise<void> {
    await fs.rm(path.join(this.#snapshotDir(serverId), `${label}.tar.gz`), {
      force: true,
    });
  }

  /**
   * Hier gibt es nichts zu übereignen.
   *
   * Ein `chown` auf UID 1000 verlangt Rechte, die ein
   * Entwicklungsrechner nicht hergibt — auf macOS scheitert er mit
   * EPERM. Stattdessen dasselbe wie beim Anlegen: 0777 auf das
   * Wurzelverzeichnis, damit der Container hineinschreiben kann, egal
   * wem es gehört.
   */
  async claim(serverId: string): Promise<void> {
    await fs.chmod(this.path(serverId), 0o777);
  }

  /**
   * Hier liegt das Backup schon als tar.gz — es wird unverändert
   * durchgereicht. Dadurch ist die Größe bekannt, und der Browser kann
   * einen Fortschritt anzeigen.
   */
  async readSnapshot(
    serverId: string,
    label: string,
  ): Promise<SnapshotArchive> {
    const archiv = path.join(this.#snapshotDir(serverId), `${label}.tar.gz`);

    const stat = await fs.stat(archiv).catch(() => null);
    if (!stat) {
      throw new Error(`Kein Backup mit der Kennung "${label}".`);
    }

    return {
      stream: createReadStream(archiv),
      sizeBytes: stat.size,
    };
  }
}

/** Rekursive Größe ohne Shell — `du` verhält sich je nach Plattform anders. */
async function directorySize(target: string): Promise<number> {
  let total = 0;

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          total += (await fs.stat(full)).size;
        } catch {
          // Datei ist zwischen readdir und stat verschwunden — ignorieren.
        }
      }
    }
  }

  await walk(target);
  return total;
}
