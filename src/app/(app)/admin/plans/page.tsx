import Link from "next/link";

import { computeCapacity, fits } from "@/lib/capacity";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

function gb(mb: number): string {
  return (mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1);
}

function euro(cents: number): string {
  return cents === 0 ? "kostenlos" : `${(cents / 100).toFixed(2)} €`;
}

export default async function PlansPage() {
  await requireAdmin();

  const [plans, node] = await Promise.all([
    db.plan.findMany({
      orderBy: { memoryMb: "asc" },
      include: { _count: { select: { servers: true } } },
    }),
    db.node.findFirst({ include: { servers: true } }),
  ]);

  const capacity = node
    ? computeCapacity(
        node,
        node.servers.reduce(
          (sum, server) => ({
            memoryMb: sum.memoryMb + server.appliedMemoryMb,
            cpuCores: sum.cpuCores + server.appliedCpuCores,
            diskMb: sum.diskMb + server.appliedDiskMb,
          }),
          { memoryMb: 0, cpuCores: 0, diskMb: 0 },
        ),
      )
    : null;

  /** Wie oft passt dieser Tarif noch auf den Node? Begrenzt durch die knappste Dimension. */
  function remainingSlots(plan: {
    memoryMb: number;
    cpuCores: number;
    diskMb: number;
  }): number | null {
    if (!capacity) return null;

    return Math.min(
      Math.floor(capacity.memoryMb.free / plan.memoryMb),
      Math.floor(capacity.cpuCores.free / plan.cpuCores),
      Math.floor(capacity.diskMb.free / plan.diskMb),
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Verwaltung</span>
          <h1>Tarife</h1>
        </div>
        <Link className="btn btn-primary" href="/admin/plans/new">
          Tarif anlegen
        </Link>
      </div>

      <p className="muted" style={{ maxWidth: "62ch" }}>
        Ein Tarif ist die Vorlage für einen Container: Arbeitsspeicher, CPU und
        Speicherplatz werden daraus als harte Grenzen gesetzt. Die Spalte „passt
        noch“ rechnet gegen die freie Kapazität des Nodes.
      </p>

      {plans.length === 0 ? (
        <div className="empty">
          <p style={{ margin: 0 }}>Noch kein Tarif angelegt.</p>
          <Link className="btn btn-primary" href="/admin/plans/new">
            Ersten Tarif anlegen
          </Link>
        </div>
      ) : (
        <div className="scroller">
          <table>
            <thead>
              <tr>
                <th>Tarif</th>
                <th>RAM</th>
                <th>CPU</th>
                <th>Disk</th>
                <th>Spieler</th>
                <th>Backups</th>
                <th>Preis</th>
                <th>Server</th>
                <th>Passt noch</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => {
                const slots = remainingSlots(plan);
                const doesFit = capacity
                  ? fits(capacity, {
                      memoryMb: plan.memoryMb,
                      cpuCores: plan.cpuCores,
                      diskMb: plan.diskMb,
                    })
                  : null;

                return (
                  <tr key={plan.id}>
                    <td>
                      <strong>{plan.name}</strong>
                      <br />
                      <code>{plan.slug}</code>{" "}
                      {plan.isPublic ? (
                        <span className="chip">öffentlich</span>
                      ) : (
                        <span className="chip chip-quiet">intern</span>
                      )}
                    </td>
                    <td className="num">{gb(plan.memoryMb)} GB</td>
                    <td className="num">{plan.cpuCores}</td>
                    <td className="num">{gb(plan.diskMb)} GB</td>
                    <td className="num">{plan.maxPlayers}</td>
                    <td className="num">{plan.maxBackups}</td>
                    <td className="num">{euro(plan.priceCents)}</td>
                    <td className="num">{plan._count.servers}</td>
                    <td className="num">
                      {slots === null ? (
                        <span className="hint">kein Node</span>
                      ) : slots > 0 ? (
                        <span>{slots}×</span>
                      ) : (
                        <span
                          className="chip chip-warn"
                          title={
                            doesFit && !doesFit.ok ? doesFit.reason : undefined
                          }
                        >
                          voll
                        </span>
                      )}
                    </td>
                    <td>
                      <Link className="btn btn-quiet btn-small" href={`/admin/plans/${plan.id}`}>
                        Bearbeiten
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {capacity ? (
        <p className="hint">
          Frei auf <code>{node?.name}</code>: {capacity.memoryMb.free} MB RAM ·{" "}
          {capacity.cpuCores.free} Kerne · {capacity.diskMb.free} MB Disk.
          Arbeitsspeicher wird nie überbucht, CPU mit Faktor{" "}
          {node?.cpuOvercommit}.
        </p>
      ) : null}
    </>
  );
}
