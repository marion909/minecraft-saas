"use client";

import { useActionState } from "react";

import { deletePlan, type PlanFormState } from "@/app/(app)/admin/plans/actions";

export function DeletePlanButton({
  planId,
  planName,
  inUse,
}: {
  planId: string;
  planName: string;
  inUse: boolean;
}) {
  const [state, formAction, pending] = useActionState<PlanFormState, FormData>(
    deletePlan,
    {},
  );

  return (
    <>
      {state.error ? <p className="notice notice-error">{state.error}</p> : null}

      <form
        action={formAction}
        onSubmit={(event) => {
          if (
            !window.confirm(
              `„${planName}“ endgültig löschen? Das lässt sich nicht rückgängig machen.`,
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="planId" value={planId} />
        <button
          className="btn btn-danger"
          type="submit"
          disabled={pending || inUse}
          title={
            inUse
              ? "Wird von Servern genutzt — stattdessen auf nicht öffentlich setzen."
              : undefined
          }
        >
          {pending ? "Wird gelöscht …" : "Löschen"}
        </button>
      </form>
    </>
  );
}
