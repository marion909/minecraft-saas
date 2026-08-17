import type { Readable } from "node:stream";

export type StorageKind = "zfs" | "directory";

export type Usage = {
  usedBytes: number;
  /** null, wenn der Treiber keine harte Grenze durchsetzen kann. */
  quotaBytes: number | null;
};

export type SnapshotInfo = {
  label: string;
  createdAt: Date;
  usedBytes: number;
};

/**
 * Der Speicher hinter einem Server. Zwei Treiber:
 *
 *   zfs        — der produktive Weg. Harte Quota, atomare Snapshots,
 *                Rollback in Sekunden.
 *   directory  — Rückfall für Entwicklungsrechner ohne ZFS. Gleiche
 *                Schnittstelle, aber KEINE harte Grenze: `hardQuota` ist
 *                false, und das Panel muss das sichtbar machen, statt eine
 *                Zusicherung vorzutäuschen, die es nicht gibt.
 */
/**
 * Ein Backup als herunterladbarer Strom.
 *
 * `sizeBytes` ist null, wenn die Größe erst beim Packen entsteht — bei
 * ZFS wird das Archiv im Vorbeigehen erzeugt, niemand weiß vorher, wie
 * groß es wird. Dann fehlt dem Browser der Fortschrittsbalken, was
 * ehrlicher ist als eine geratene Zahl.
 */
export type SnapshotArchive = {
  stream: Readable;
  sizeBytes: number | null;
};

export interface Storage {
  readonly kind: StorageKind;
  readonly hardQuota: boolean;

  /** Hostpfad, der in den Container als /data gebunden wird. */
  path(serverId: string): string;

  create(serverId: string, quotaMb: number): Promise<string>;
  setQuota(serverId: string, quotaMb: number): Promise<void>;
  usage(serverId: string): Promise<Usage>;
  exists(serverId: string): Promise<boolean>;
  destroy(serverId: string): Promise<void>;

  snapshot(serverId: string, label: string): Promise<void>;
  listSnapshots(serverId: string): Promise<SnapshotInfo[]>;
  rollback(serverId: string, label: string): Promise<void>;
  destroySnapshot(serverId: string, label: string): Promise<void>;

  /**
   * Ein Backup zum Herunterladen — immer als tar.gz, unabhängig davon,
   * wie der Treiber es intern hält. Ein ZFS-Snapshot nützt außerhalb
   * dieses Hosts niemandem; ein Archiv kann jeder öffnen.
   */
  readSnapshot(serverId: string, label: string): Promise<SnapshotArchive>;

  /**
   * Macht den Inhalt für den Container-Benutzer schreibbar.
   *
   * Nötig, nachdem Dateien am Container vorbei entstanden sind — beim
   * Einspielen eines Archivs etwa. Wie das geht, weiß nur der Treiber:
   * Auf dem Host mit ZFS gehört alles UID 1000 und wird übereignet, auf
   * einem Entwicklungsrechner ohne passende Rechte hilft nur der
   * Verzicht auf Eigentümerprüfung. Wer das in die Import-Logik legt,
   * baut ein `chown`, das auf dem einen System nötig und auf dem
   * anderen unmöglich ist.
   */
  claim(serverId: string): Promise<void>;
}
