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
}
