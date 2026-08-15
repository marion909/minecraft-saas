import Link from "next/link";

import { db } from "@/lib/db";
import { computeCapacity } from "@/lib/capacity";
import { requireAdmin } from "@/lib/session";

export default async function AdminPage() {
  await requireAdmin();

  const [userCount, planCount, nodes] = await Promise.all([
    db.user.count(),
    db.plan.count(),
    db.node.findMany({ include: { servers: true } }),
  ]);

  return (
    <>
      <div>
        <span className="eyebrow">Verwaltung</span>
        <h1>Admin</h1>
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1.15rem" }}>Bestand</h2>
        <p className="muted">
          {userCount} {userCount === 1 ? "Konto" : "Konten"} · {planCount}{" "}
          {planCount === 1 ? "Tarif" : "Tarife"} · {nodes.length}{" "}
          {nodes.length === 1 ? "Node" : "Nodes"}
        </p>
        <div className="actions">
          <Link className="btn btn-quiet" href="/admin/users">
            Konten verwalten
          </Link>
          <Link className="btn btn-quiet" href="/admin/plans">
            Tarife verwalten
          </Link>
        </div>
      </div>

      {nodes.length === 0 ? (
        <div className="empty">
          <p style={{ margin: 0 }}>Noch kein Node eingetragen.</p>
          <p className="hint" style={{ maxWidth: "34rem" }}>
            Der Node beschreibt den Linux-Host: Gesamtressourcen, reservierter
            Anteil für OS und ZFS-ARC, Adresse des Agents. Anlegen über{" "}
            <code>pnpm db:seed</code>, sobald die Eckdaten feststehen.
          </p>
        </div>
      ) : (
        nodes.map((node) => {
          const allocated = node.servers.reduce(
            (sum, server) => ({
              memoryMb: sum.memoryMb + server.appliedMemoryMb,
              cpuCores: sum.cpuCores + server.appliedCpuCores,
              diskMb: sum.diskMb + server.appliedDiskMb,
            }),
            { memoryMb: 0, cpuCores: 0, diskMb: 0 },
          );

          const capacity = computeCapacity(node, allocated);

          return (
            <div className="card" key={node.id}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <h2 style={{ fontSize: "1.15rem" }}>{node.name}</h2>
                <span className="chip">{node.status}</span>
              </div>
              <p className="muted">
                RAM {capacity.memoryMb.allocated} / {capacity.memoryMb.capacity} MB
                belegt · CPU {capacity.cpuCores.allocated} /{" "}
                {capacity.cpuCores.capacity} Kerne · Disk{" "}
                {capacity.diskMb.allocated} / {capacity.diskMb.capacity} MB
              </p>
              <p className="hint">
                {node.servers.length}{" "}
                {node.servers.length === 1 ? "Server" : "Server"} auf diesem Node.
                Reserviert für OS, ZFS-ARC und Dienste: {node.reservedMemoryMb} MB.
              </p>
            </div>
          );
        })
      )}
    </>
  );
}
