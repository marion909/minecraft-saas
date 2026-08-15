import Link from "next/link";

import { ServerStatus } from "@/generated/prisma/enums";
import { computeCapacity } from "@/lib/capacity";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { formatMb } from "@/lib/status-label";

/** Ein Kasten der Startseite: Zahl, Name, Weg dorthin. */
function Bereich({
  titel,
  zahl,
  zeile,
  href,
  aktion,
}: {
  titel: string;
  zahl: string;
  zeile: string;
  href: string;
  aktion: string;
}) {
  return (
    <div className="card">
      <span className="eyebrow">{titel}</span>
      <p className="kennzahl-wert" style={{ fontSize: "1.6rem" }}>
        {zahl}
      </p>
      <p className="hint">{zeile}</p>
      <div className="actions">
        <Link className="btn btn-quiet" href={href}>
          {aktion}
        </Link>
      </div>
    </div>
  );
}

export default async function AdminPage() {
  await requireAdmin();

  const [userCount, planCount, serverCount, runningCount, nodes] =
    await Promise.all([
      db.user.count(),
      db.plan.count(),
      db.server.count(),
      db.server.count({ where: { status: ServerStatus.RUNNING } }),
      db.node.findMany({
        include: {
          servers: {
            select: {
              appliedMemoryMb: true,
              appliedCpuCores: true,
              appliedDiskMb: true,
            },
          },
        },
      }),
    ]);

  const gesamt = nodes.reduce(
    (sum, node) => {
      const allocated = node.servers.reduce(
        (inner, server) => ({
          memoryMb: inner.memoryMb + server.appliedMemoryMb,
          cpuCores: inner.cpuCores + server.appliedCpuCores,
          diskMb: inner.diskMb + server.appliedDiskMb,
        }),
        { memoryMb: 0, cpuCores: 0, diskMb: 0 },
      );

      const capacity = computeCapacity(node, allocated);

      return {
        freiMemoryMb: sum.freiMemoryMb + capacity.memoryMb.free,
        freiDiskMb: sum.freiDiskMb + capacity.diskMb.free,
        online: sum.online + (node.status === "ONLINE" ? 1 : 0),
      };
    },
    { freiMemoryMb: 0, freiDiskMb: 0, online: 0 },
  );

  return (
    <>
      <div>
        <span className="eyebrow">Verwaltung</span>
        <h1>Admin</h1>
      </div>

      <div className="bereiche">
        <Bereich
          titel="Server"
          zahl={String(serverCount)}
          zeile={`${runningCount} davon laufen gerade`}
          href="/admin/servers"
          aktion="Alle Server"
        />
        <Bereich
          titel="Konten"
          zahl={String(userCount)}
          zeile="Registrierung ist geschlossen — Konten entstehen hier"
          href="/admin/users"
          aktion="Konten verwalten"
        />
        <Bereich
          titel="Tarife"
          zahl={String(planCount)}
          zeile="Vorlagen für Arbeitsspeicher, CPU und Platte"
          href="/admin/plans"
          aktion="Tarife verwalten"
        />
        <Bereich
          titel="Nodes"
          zahl={`${nodes.length}`}
          zeile={
            nodes.length === 0
              ? "Ohne Node lässt sich kein Server anlegen"
              : `${gesamt.online} online · noch ${formatMb(gesamt.freiMemoryMb)} RAM und ${formatMb(gesamt.freiDiskMb)} Platte frei`
          }
          href="/admin/nodes"
          aktion="Nodes verwalten"
        />
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1.15rem" }}>Host</h2>
        <p className="muted" style={{ maxWidth: "62ch" }}>
          Laufzeit, Last, Speicher und ausstehende Neustarts der Maschinen —
          und der Weg, sie zu schalten, ohne dass die Welten Schaden nehmen.
        </p>
        <div className="actions">
          <Link className="btn btn-quiet" href="/admin/host">
            Host ansehen und steuern
          </Link>
        </div>
      </div>
    </>
  );
}
