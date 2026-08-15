"use client";

import { useActionState } from "react";

import { deleteNode, type NodeFormState } from "@/app/(app)/admin/nodes/actions";

export function DeleteNodeButton({
  nodeId,
  name,
  serverCount,
}: {
  nodeId: string;
  name: string;
  serverCount: number;
}) {
  const [state, formAction, pending] = useActionState<NodeFormState, FormData>(
    deleteNode,
    {},
  );

  const blocked = serverCount > 0;

  return (
    <>
      <form
        action={formAction}
        onSubmit={(event) => {
          if (
            !window.confirm(
              `Node „${name}“ aus dem Panel entfernen? ` +
                `Auf dem Host selbst ändert das nichts — Container, Daten und ` +
                `Dienste laufen weiter, das Panel weiß nur nichts mehr von ihnen.`,
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="nodeId" value={nodeId} />
        <button
          className="btn btn-danger"
          type="submit"
          disabled={pending || blocked}
          title={
            blocked
              ? `Trägt noch ${serverCount} Server. Erst die Server abräumen.`
              : undefined
          }
        >
          {pending ? "…" : "Node entfernen"}
        </button>
      </form>

      {state.error ? (
        <p className="notice notice-error">{state.error}</p>
      ) : null}
    </>
  );
}
