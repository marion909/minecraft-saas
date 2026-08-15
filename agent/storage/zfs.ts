import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { datasetName } from "../naming.ts";
import { CONTAINER_GID, CONTAINER_UID } from "../spec.ts";
import type { SnapshotInfo, Storage, Usage } from "./types.ts";

const run = promisify(execFile);

/**
 * ZFS-Treiber. Alle Aufrufe gehen über execFile mit Argument-Array —
 * nie über eine Shell. Damit kann auch ein durchgerutschter Name kein
 * zweites Kommando anhängen.
 *
 * Rechte kommen aus `zfs allow` für das Dienstkonto, siehe Host-Runbook.
 */
export class ZfsStorage implements Storage {
  readonly kind = "zfs" as const;
  readonly hardQuota = true;

  private readonly pool: string;
  private readonly mountRoot: string;

  constructor(pool: string, mountRoot: string) {
    this.pool = pool;
    this.mountRoot = mountRoot;
  }

  path(serverId: string): string {
    return `${this.mountRoot}/srv-${serverId}`;
  }

  #dataset(serverId: string): string {
    return datasetName(this.pool, serverId);
  }

  async create(serverId: string, quotaMb: number): Promise<string> {
    const dataset = this.#dataset(serverId);

    await run("zfs", [
      "create",
      "-o",
      `quota=${quotaMb}M`,
      "-o",
      "compression=lz4",
      "-o",
      "atime=off",
      dataset,
    ]);

    // Ein Dataset kann angelegt und trotzdem nicht eingehängt sein:
    // `zfs create` meldet das nur als Warnung und endet mit 0. Ohne diese
    // Prüfung scheitert erst das chown darauf, und die Meldung spricht
    // dann von einer fehlenden Datei statt von der Ursache.
    const { stdout: mounted } = await run("zfs", [
      "get",
      "-H",
      "-o",
      "value",
      "mounted",
      dataset,
    ]);

    if (mounted.trim() !== "yes") {
      throw new Error(
        `Dataset ${dataset} ist angelegt, aber nicht eingehängt. ` +
          `Unter Linux verlangt das Einhängen mehr als \`zfs allow mount\` — ` +
          `prüfe die Rechte des Dienstkontos in mc-agent.service. ` +
          `Nachsehen mit: zfs get mounted,mountpoint ${dataset}`,
      );
    }

    // Das itzg-Image läuft als UID 1000; gehört das Verzeichnis root,
    // startet der Server nicht.
    const target = this.path(serverId);
    await run("chown", [`${CONTAINER_UID}:${CONTAINER_GID}`, target]);

    return target;
  }

  async setQuota(serverId: string, quotaMb: number): Promise<void> {
    await run("zfs", ["set", `quota=${quotaMb}M`, this.#dataset(serverId)]);
  }

  async usage(serverId: string): Promise<Usage> {
    const { stdout } = await run("zfs", [
      "list",
      "-Hp",
      "-o",
      "used,quota",
      this.#dataset(serverId),
    ]);

    const [used, quota] = stdout.trim().split("\t");

    return {
      usedBytes: Number(used ?? 0),
      // ZFS meldet 0, wenn keine Quota gesetzt ist.
      quotaBytes: Number(quota ?? 0) || null,
    };
  }

  async exists(serverId: string): Promise<boolean> {
    try {
      await run("zfs", ["list", this.#dataset(serverId)]);
      return true;
    } catch {
      return false;
    }
  }

  async destroy(serverId: string): Promise<void> {
    // -r nimmt die Snapshots mit; ohne das schlägt destroy fehl, sobald
    // je ein Backup angelegt wurde.
    await run("zfs", ["destroy", "-r", this.#dataset(serverId)]);
  }

  async snapshot(serverId: string, label: string): Promise<void> {
    await run("zfs", ["snapshot", `${this.#dataset(serverId)}@${label}`]);
  }

  async listSnapshots(serverId: string): Promise<SnapshotInfo[]> {
    const { stdout } = await run("zfs", [
      "list",
      "-Hp",
      "-t",
      "snapshot",
      "-o",
      "name,creation,used",
      "-s",
      "creation",
      "-r",
      this.#dataset(serverId),
    ]);

    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, creation, used] = line.split("\t");
        return {
          label: (name ?? "").split("@")[1] ?? "",
          createdAt: new Date(Number(creation ?? 0) * 1000),
          usedBytes: Number(used ?? 0),
        };
      });
  }

  async rollback(serverId: string, label: string): Promise<void> {
    // -r verwirft neuere Snapshots, die sonst den Rollback blockieren.
    await run("zfs", ["rollback", "-r", `${this.#dataset(serverId)}@${label}`]);
  }

  async destroySnapshot(serverId: string, label: string): Promise<void> {
    await run("zfs", ["destroy", `${this.#dataset(serverId)}@${label}`]);
  }
}
