import Link from "next/link";

import { AgentClient } from "@/lib/agent";
import { computeCapacity, type Capacity } from "@/lib/capacity";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { formatMb } from "@/lib/status-label";

/** Wie viel Prozent einer Dimension vergeben sind — für den Balken. */
function share(dimension: { capacity: number; allocated: number }): number {
  if (dimension.capacity <= 0) return 100;
  return Math.min(100, Math.round((dimension.allocated / dimension.capacity) * 100));
}

function Meter({
  label,
  dimension,
  format,
}: {
  label: string;
  dimension: Capacity["memoryMb"];
  format: (value: number) => string;
}) {
  const percent = share(dimension);

  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className="num">
          {format(dimension.allocated)} / {format(dimension.capacity)}
        </span>
      </div>
      <div className="meter-track">
        <div
          // Ab 90 % rot: Was darüber liegt, reicht für keinen weiteren
          // Server mehr, und genau das soll im Überflug auffallen.
          className={`meter-fill ${
            percent >= 90 ? "meter-bad" : percent >= 70 ? "meter-busy" : "meter-ok"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

const NODE_TONE: Record<string, string> = {
  ONLINE: "chip-ok",
  DRAINING: "chip-warn",
  OFFLINE: "chip-bad",
};

export default async function NodesPage() {
  await requireAdmin();

  const nodes = await db.node.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      servers: {
        select: { appliedMemoryMb: true, appliedCpuCores: true, appliedDiskMb: true },
      },
    },
  });

  // Alle Agents gleichzeitig fragen statt nacheinander: Bei drei toten
  // Nodes wäre die Seite sonst dreimal so lange blockiert. Der Client
  // bricht nach sechs Sekunden ab.
  const health = await Promise.all(
    nodes.map((node) =>
      AgentClient.forNode(node)
        .health()
        .then((result) => ({ ok: true as const, result }))
        .catch((error: unknown) => ({
          ok: false as const,
          reason: error instanceof Error ? error.message : "Nicht erreichbar.",
        })),
    ),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Verwaltung</span>
          <h1>Nodes</h1>
        </div>
        <Link className="btn btn-primary" href="/admin/nodes/new">
          Node hinzufügen
        </Link>
      </div>

      <p className="muted" style={{ maxWidth: "62ch" }}>
        Ein Node ist ein Linux-Host mit Agent, Docker und Speicher. Neue Server
        landen auf dem ersten Node im Zustand ONLINE, auf dem sie noch
        hineinpassen.
      </p>

      {nodes.length === 0 ? (
        <div className="empty">
          <p style={{ margin: 0 }}>Noch kein Node eingetragen.</p>
          <p className="hint" style={{ maxWidth: "34rem" }}>
            Ohne Node lässt sich kein Server anlegen — das Panel wüsste nicht,
            wen es fragen soll. Adresse und Token des Agents stehen in der{" "}
            <code>.env</code> des Hosts.
          </p>
          <Link className="btn btn-primary" href="/admin/nodes/new">
            Ersten Node hinzufügen
          </Link>
        </div>
      ) : (
        nodes.map((node, index) => {
          const allocated = node.servers.reduce(
            (sum, server) => ({
              memoryMb: sum.memoryMb + server.appliedMemoryMb,
              cpuCores: sum.cpuCores + server.appliedCpuCores,
              diskMb: sum.diskMb + server.appliedDiskMb,
            }),
            { memoryMb: 0, cpuCores: 0, diskMb: 0 },
          );

          const capacity = computeCapacity(node, allocated);
          const state = health[index];

          return (
            <div className="card" key={node.id}>
              <div className="page-head" style={{ marginBottom: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <h2 style={{ fontSize: "1.15rem", margin: 0 }}>{node.name}</h2>
                  <span className={`chip ${NODE_TONE[node.status] ?? ""}`}>
                    {node.status}
                  </span>
                  {state?.ok ? (
                    <span className="chip chip-ok">Agent erreichbar</span>
                  ) : (
                    <span className="chip chip-bad">Agent stumm</span>
                  )}
                </div>
                <Link className="btn btn-quiet" href={`/admin/nodes/${node.id}`}>
                  Bearbeiten
                </Link>
              </div>

              <p className="hint">
                <code>{node.agentUrl}</code> · Serveradressen:{" "}
                <code>*.{node.publicHost}</code> · {node.servers.length}{" "}
                {node.servers.length === 1 ? "Server" : "Server"}
              </p>

              {state && !state.ok ? (
                <p className="notice notice-warn">
                  {state.reason} Die Kapazität unten stammt aus der Datenbank
                  und sagt nichts darüber, was auf dem Host gerade wirklich
                  läuft.
                </p>
              ) : null}

              {state?.ok && !state.result.storage.hardQuota ? (
                <p className="notice notice-warn">
                  Speichertreiber <code>{state.result.storage.kind}</code> ohne
                  harte Quota — Server können ihre Grenze überschreiten und den
                  Node volllaufen lassen.
                </p>
              ) : null}

              <div className="meters">
                <Meter label="Arbeitsspeicher" dimension={capacity.memoryMb} format={formatMb} />
                <Meter
                  label="CPU"
                  dimension={capacity.cpuCores}
                  format={(value) => {
                    const kerne = Math.round(value * 10) / 10;
                    return `${kerne} ${kerne === 1 ? "Kern" : "Kerne"}`;
                  }}
                />
                <Meter label="Speicherplatz" dimension={capacity.diskMb} format={formatMb} />
              </div>

              <p className="hint">
                Reserviert für System und Dienste: {formatMb(node.reservedMemoryMb)}{" "}
                RAM, {formatMb(node.reservedDiskMb)} Platte · CPU-Überbuchung ×
                {node.cpuOvercommit}
              </p>
            </div>
          );
        })
      )}
    </>
  );
}
