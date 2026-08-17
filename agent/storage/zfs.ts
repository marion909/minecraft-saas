import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

import { datasetName } from "../naming.ts";
import { chownRecursive, CONTAINER_GID, CONTAINER_UID } from "../restore.ts";
import type { SnapshotArchive, SnapshotInfo, Storage, Usage } from "./types.ts";

const run = promisify(execFile);

/** Root-eigenes Skript für die Schritte, die Benutzer-ID 0 verlangen. */
const HELPER = "/usr/local/sbin/mc-zfs-helper";

/**
 * ZFS-Treiber. Alle Aufrufe gehen über execFile mit Argument-Array —
 * nie über eine Shell. Damit kann auch ein durchgerutschter Name kein
 * zweites Kommando anhängen.
 *
 * Die meisten Rechte kommen aus `zfs allow` für das Dienstkonto. Was
 * ein- oder aushängt, geht über den Helfer; siehe #privileged.
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

  /**
   * Einhängen, Zerstören und Zurückrollen verlangen unter Linux
   * Benutzer-ID 0. `zfs allow` deckt das nicht ab, und CAP_SYS_ADMIN
   * genügt ZFS ebenfalls nicht — die Prüfung hängt an der echten
   * Benutzer-ID, nicht an der Capability.
   *
   * Deshalb genau diese drei Schritte über ein root-eigenes Skript mit
   * eigener Argumentprüfung. Alles andere — anlegen, Quota setzen,
   * auflisten, Snapshots — läuft weiter unprivilegiert über `zfs allow`.
   */
  async #privileged(...args: string[]): Promise<void> {
    try {
      await run("sudo", ["-n", HELPER, ...args]);
    } catch (error) {
      const detail =
        typeof error === "object" && error !== null && "stderr" in error
          ? String((error as { stderr: unknown }).stderr).trim()
          : String(error);

      throw new Error(
        `${HELPER} ${args.join(" ")} fehlgeschlagen: ${detail} — ` +
          `liegt der Helfer dort und erlaubt /etc/sudoers.d/mc-agent ihn?`,
      );
    }
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

    // `zfs create` versucht selbst einzuhängen und scheitert daran als
    // Dienstkonto — gemeldet nur als Warnung, der Rückgabewert bleibt 0.
    // Der Helfer zieht es nach und übereignet den Einhängepunkt gleich
    // dem Container-Benutzer (das itzg-Image läuft als UID 1000).
    await this.#privileged("mount", dataset);

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
          `Nachsehen mit: zfs get mounted,mountpoint ${dataset}`,
      );
    }

    return this.path(serverId);
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
    // Zerstören hängt vorher aus, und das geht nur als root.
    await this.#privileged("destroy", this.#dataset(serverId));
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
    // Zurückrollen hängt das Dateisystem zwischendurch aus.
    await this.#privileged("rollback", this.#dataset(serverId), label);
  }

  async destroySnapshot(serverId: string, label: string): Promise<void> {
    await run("zfs", ["destroy", `${this.#dataset(serverId)}@${label}`]);
  }

  /**
   * Übereignet den Baum dem Container-Benutzer (UID 1000 im itzg-Image).
   *
   * Ohne das könnte der Server seine eigene Welt nicht speichern, nachdem
   * ein Archiv eingespielt wurde — die Dateien gehörten dem Agent.
   * Braucht CAP_CHOWN, das die systemd-Unit mitgibt.
   */
  async claim(serverId: string): Promise<void> {
    await chownRecursive(this.path(serverId), CONTAINER_UID, CONTAINER_GID);
  }

  /**
   * Packt einen Snapshot beim Herunterladen zu tar.gz.
   *
   * Der Zugriff läuft über `.zfs/snapshot/<label>` unterhalb des
   * Einhängepunkts. Das Verzeichnis ist unsichtbar (`snapdir=hidden` ist
   * die Voreinstellung), aber begehbar — ZFS hängt den Snapshot beim
   * ersten Zugriff selbst ein.
   *
   * Bewusst nicht `zfs send`: Dessen Strom lässt sich nur auf einem
   * anderen ZFS wieder einlesen. Wer sein Backup herunterlädt, will
   * hineinsehen können, und sei es nur, um eine einzelne Datei
   * herauszuholen.
   *
   * Die Größe steht vorher nicht fest — das Archiv entsteht erst beim
   * Übertragen.
   */
  async readSnapshot(
    serverId: string,
    label: string,
  ): Promise<SnapshotArchive> {
    const verzeichnis = `${this.path(serverId)}/.zfs/snapshot/${label}`;

    try {
      await fs.access(verzeichnis);
    } catch {
      throw new Error(
        `Snapshot "${label}" ist unter ${verzeichnis} nicht erreichbar. ` +
          `Existiert er noch (zfs list -t snapshot), und ist snapdir nicht ` +
          `auf "disabled" gesetzt?`,
      );
    }

    const kind = spawn("tar", ["-czf", "-", "-C", verzeichnis, "."], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let fehler = "";
    kind.stderr.on("data", (teil: Buffer) => {
      // Nur den Anfang behalten; tar kann sehr gesprächig werden.
      if (fehler.length < 2000) fehler += teil.toString("utf8");
    });

    kind.on("close", (code) => {
      if (code !== 0) {
        kind.stdout.destroy(
          new Error(`tar endete mit ${code}: ${fehler.trim() || "kein Grund genannt"}`),
        );
      }
    });

    return { stream: kind.stdout, sizeBytes: null };
  }
}
