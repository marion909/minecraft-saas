import Link from "next/link";

import { CreateServerForm, type PlanChoice } from "@/components/create-server-form";
import { computeCapacity } from "@/lib/capacity";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export default async function NewServerPage() {
  const session = await requireUser();
  const admin = isAdmin(session.user.role);

  const [plans, node, owned] = await Promise.all([
    db.plan.findMany({
      where: admin ? {} : { isPublic: true },
      orderBy: { memoryMb: "asc" },
    }),
    db.node.findFirst({ where: { status: "ONLINE" }, include: { servers: true } }),
    db.server.count({ where: { userId: session.user.id } }),
  ]);

  if (!node) {
    return (
      <>
        <h1>Server anlegen</h1>
        <p className="notice notice-error">
          Zurzeit ist kein Node verfügbar. Ohne einen laufenden Node-Agent kann
          kein Server angelegt werden.
        </p>
      </>
    );
  }

  const allocated = node.servers.reduce(
    (sum, server) => ({
      memoryMb: sum.memoryMb + server.appliedMemoryMb,
      cpuCores: sum.cpuCores + server.appliedCpuCores,
      diskMb: sum.diskMb + server.appliedDiskMb,
    }),
    { memoryMb: 0, cpuCores: 0, diskMb: 0 },
  );

  const capacity = computeCapacity(node, allocated);

  const choices: PlanChoice[] = plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    memoryMb: plan.memoryMb,
    cpuCores: plan.cpuCores,
    diskMb: plan.diskMb,
    maxPlayers: plan.maxPlayers,
    priceCents: plan.priceCents,
    slots: Math.min(
      Math.floor(capacity.memoryMb.free / plan.memoryMb),
      Math.floor(capacity.cpuCores.free / plan.cpuCores),
      Math.floor(capacity.diskMb.free / plan.diskMb),
    ),
  }));

  return (
    <>
      <div>
        <span className="eyebrow">Neuer Server</span>
        <h1>Server anlegen</h1>
      </div>

      {choices.length === 0 ? (
        <div className="empty">
          <p style={{ margin: 0 }}>Zurzeit ist kein Tarif buchbar.</p>
          {admin ? (
            <Link className="btn btn-quiet" href="/admin/plans">
              Tarife verwalten
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="card" style={{ maxWidth: "44rem" }}>
          <CreateServerForm plans={choices} baseDomain={node.baseDomain} />
        </div>
      )}

      <p className="hint">
        Du betreibst derzeit {owned} {owned === 1 ? "Server" : "Server"}.
      </p>
    </>
  );
}
