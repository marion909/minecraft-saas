import Link from "next/link";
import { notFound } from "next/navigation";

import { ServerStatus } from "@/generated/prisma/enums";
import { BackupPanel, type BackupEntry } from "@/components/backup-panel";
import { AgentClient } from "@/lib/agent";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { requireUser } from "@/lib/session";

/** Zustände, in denen ein Backup oder Restore nicht angestoßen werden darf. */
const BUSY: ServerStatus[] = [
  ServerStatus.PROVISIONING,
  ServerStatus.STARTING,
  ServerStatus.STOPPING,
  ServerStatus.DELETING,
];

export default async function BackupsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireUser();
  const { id } = await params;

  const server = await db.server.findUnique({
    where: { id },
    include: { node: true, plan: true },
  });

  if (
    !server ||
    (server.userId !== session.user.id && !isAdmin(session.user.role))
  ) {
    notFound();
  }

  // Die Wahrheit steht auf der Platte, nicht in der Datenbank. Die Tabelle
  // liefert nur Zusatzangaben, die der Agent nicht kennt.
  const [listing, records] = await Promise.all([
    AgentClient.forNode(server.node)
      .listBackups(server.id)
      .catch(() => null),
    db.backup.findMany({ where: { serverId: server.id } }),
  ]);

  const notes = new Map(records.map((record) => [record.snapshotName, record.note]));

  const backups: BackupEntry[] = (listing?.backups ?? [])
    .map((backup) => ({
      label: backup.label,
      createdAt: backup.createdAt,
      usedBytes: backup.usedBytes,
      note: notes.get(backup.label) ?? null,
    }))
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">{server.name}</span>
          <h1>Backups</h1>
        </div>
        <Link className="btn btn-quiet" href={`/servers/${server.id}`}>
          Zurück zum Server
        </Link>
      </div>

      {!listing ? (
        <p className="notice notice-error">
          Der Node-Agent antwortet nicht — Backups sind gerade nicht abrufbar.
        </p>
      ) : (
        <>
          {!listing.hardQuota ? (
            <p className="notice notice-warn">
              Dieser Node läuft ohne ZFS. Backups sind hier vollständige
              Archive statt Snapshots: langsamer, und sie brauchen den Platz
              der ganzen Welt.
            </p>
          ) : null}

          <div className="card">
            <BackupPanel
              serverId={server.id}
              serverName={server.name}
              backups={backups}
              maxBackups={server.plan.maxBackups}
              incremental={listing.hardQuota}
              busy={BUSY.includes(server.status)}
            />
          </div>
        </>
      )}
    </>
  );
}
