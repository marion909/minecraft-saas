import { EMPTY_PLAN, PlanForm } from "@/components/plan-form";
import { requireAdmin } from "@/lib/session";

import { createPlan } from "../actions";

export default async function NewPlanPage() {
  await requireAdmin();

  return (
    <>
      <div>
        <span className="eyebrow">Tarife</span>
        <h1>Neuer Tarif</h1>
      </div>

      <div className="card" style={{ maxWidth: "48rem" }}>
        <PlanForm
          action={createPlan}
          defaults={EMPTY_PLAN}
          submitLabel="Tarif anlegen"
        />
      </div>
    </>
  );
}
