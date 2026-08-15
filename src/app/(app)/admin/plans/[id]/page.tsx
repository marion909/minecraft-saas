import { notFound } from "next/navigation";

import { DeletePlanButton } from "@/components/delete-plan-button";
import { PlanForm } from "@/components/plan-form";
import { heapForContainer } from "@/lib/capacity";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

import { updatePlan } from "../actions";

export default async function EditPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id } = await params;

  const plan = await db.plan.findUnique({
    where: { id },
    include: { _count: { select: { servers: true } } },
  });

  if (!plan) {
    notFound();
  }

  // Server Action mit der ID vorbelegen, damit das Formular generisch bleibt.
  const action = updatePlan.bind(null, plan.id);

  let heapHint: string;
  try {
    const heap = heapForContainer(plan.memoryMb);
    heapHint = `Bei ${plan.memoryMb} MB Container-Limit bekommt die JVM ${heap} MB Heap — die Differenz ist Metaspace, Thread-Stacks und GC.`;
  } catch (error) {
    heapHint =
      error instanceof Error ? error.message : "Speicherwert nicht nutzbar.";
  }

  return (
    <>
      <div>
        <span className="eyebrow">Tarife</span>
        <h1>{plan.name}</h1>
      </div>

      <p className="notice">{heapHint}</p>

      {plan._count.servers > 0 ? (
        <p className="notice notice-warn">
          {plan._count.servers} Server nutzen diesen Tarif. Änderungen an
          Arbeitsspeicher, CPU oder Speicherplatz gelten erst, wenn der jeweilige
          Container neu erstellt wird — bis dahin behalten die Server ihre
          bisherigen Grenzen. Das Panel weist die Betroffenen darauf hin.
        </p>
      ) : null}

      <div className="card" style={{ maxWidth: "48rem" }}>
        <PlanForm
          action={action}
          defaults={{
            name: plan.name,
            slug: plan.slug,
            memoryMb: plan.memoryMb,
            cpuCores: plan.cpuCores,
            diskMb: plan.diskMb,
            maxPlayers: plan.maxPlayers,
            maxBackups: plan.maxBackups,
            maxServers: plan.maxServers,
            priceCents: plan.priceCents,
            isPublic: plan.isPublic,
          }}
          submitLabel="Änderungen speichern"
        />
      </div>

      <div className="card danger-zone" style={{ maxWidth: "48rem" }}>
        <h2 style={{ fontSize: "1.05rem" }}>Tarif löschen</h2>
        <p className="muted">
          {plan._count.servers > 0
            ? "Solange Server darauf laufen, ist Löschen gesperrt. Setze den Tarif stattdessen auf nicht öffentlich — dann verschwindet er aus der Bestellung, ohne dass laufende Server betroffen sind."
            : "Der Tarif wird nicht mehr genutzt und kann entfernt werden."}
        </p>
        <DeletePlanButton
          planId={plan.id}
          planName={plan.name}
          inUse={plan._count.servers > 0}
        />
      </div>
    </>
  );
}
