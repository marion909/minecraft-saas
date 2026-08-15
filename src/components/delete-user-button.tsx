"use client";

import { useActionState } from "react";

import { deleteUser, type UserFormState } from "@/app/(app)/admin/users/actions";

export function DeleteUserButton({
  userId,
  name,
  email,
  serverCount,
}: {
  userId: string;
  name: string;
  email: string;
  serverCount: number;
}) {
  const [state, formAction, pending] = useActionState<UserFormState, FormData>(
    deleteUser,
    {},
  );

  const blocked = serverCount > 0;

  return (
    <>
      <form
        action={formAction}
        onSubmit={(event) => {
          // Die Adresse in der Rückfrage, nicht nur den Namen: In einer
          // Liste mit zwei „Marion“ ist der Name kein Unterscheidungsmerkmal,
          // und genau dann klickt man daneben.
          if (
            !window.confirm(
              `Konto „${name}“ (${email}) endgültig löschen? ` +
                `Anmeldung und Sitzungen sind sofort weg. ` +
                `Das lässt sich nicht rückgängig machen.`,
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="userId" value={userId} />
        <button
          className="btn btn-danger btn-small"
          type="submit"
          disabled={pending || blocked}
          title={
            blocked
              ? `Hat noch ${serverCount} Server. Erst die Server löschen.`
              : undefined
          }
        >
          {pending ? "…" : "Löschen"}
        </button>
      </form>

      {state.error ? (
        <span className="field-error" style={{ display: "block" }}>
          {state.error}
        </span>
      ) : null}
    </>
  );
}
