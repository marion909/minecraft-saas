import Link from "next/link";
import { notFound } from "next/navigation";

import { DeleteNodeButton } from "@/components/delete-node-button";
import { NodeForm } from "@/components/node-form";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/status-label";

import { updateNode } from "../actions";

export default async function EditNodePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id } = await params;

  const node = await db.node.findUnique({
    where: { id },
    include: {
      servers: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { name: true, email: true } } },
      },
    },
  });

  if (!node) {
    notFound();
  }

  const action = updateNode.bind(null, node.id);

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Nodes</span>
          <h1>{node.name}</h1>
        </div>
        <Link className="btn btn-quiet" href="/admin/host">
          Host steuern
        </Link>
      </div>

      <div className="card" style={{ maxWidth: "52rem" }}>
        <NodeForm
          action={action}
          nodeId={node.id}
          defaults={{
            name: node.name,
            agentUrl: node.agentUrl,
            publicHost: node.publicHost,
            totalMemoryMb: node.totalMemoryMb,
            totalCpuCores: node.totalCpuCores,
            totalDiskMb: node.totalDiskMb,
            reservedMemoryMb: node.reservedMemoryMb,
            reservedDiskMb: node.reservedDiskMb,
            cpuOvercommit: node.cpuOvercommit,
            status: node.status,
          }}
          submitLabel="Änderungen speichern"
        />
      </div>

      <div className="card" style={{ maxWidth: "52rem" }}>
        <h2 style={{ fontSize: "1.05rem" }}>
          Server auf diesem Node ({node.servers.length})
        </h2>

        {node.servers.length === 0 ? (
          <p className="muted">Noch keiner.</p>
        ) : (
          <div className="scroller">
            <table>
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Besitzer</th>
                  <th>Zustand</th>
                </tr>
              </thead>
              <tbody>
                {node.servers.map((server) => (
                  <tr key={server.id}>
                    <td>
                      <Link href={`/servers/${server.id}`}>{server.name}</Link>
                      <br />
                      <code>
                        {server.subdomain}.{node.publicHost}
                      </code>
                    </td>
                    <td>{server.user.name}</td>
                    <td>
                      <span className={`chip chip-${STATUS_TONE[server.status]}`}>
                        {STATUS_LABEL[server.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card danger-zone" style={{ maxWidth: "52rem" }}>
        <h2 style={{ fontSize: "1.05rem" }}>Node entfernen</h2>
        <p className="muted">
          {node.servers.length > 0
            ? "Solange Server eingetragen sind, ist das gesperrt — sie hätten sonst keinen Host mehr, obwohl ihre Container weiterlaufen."
            : "Entfernt nur den Eintrag im Panel. Der Host selbst läuft weiter; Agent, Docker und Daten bleiben unangetastet."}
        </p>
        <DeleteNodeButton
          nodeId={node.id}
          name={node.name}
          serverCount={node.servers.length}
        />
      </div>

      <p>
        <Link href="/admin/nodes">Zurück zur Übersicht</Link>
      </p>
    </>
  );
}
