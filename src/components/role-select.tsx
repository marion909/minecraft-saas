"use client";

import { useActionState } from "react";

import { setUserRole, type UserFormState } from "@/app/(app)/admin/users/actions";
import { ROLES } from "@/lib/roles";

/**
 * Rollenwechsel direkt in der Liste. Abschicken beim Wechseln, weil ein
 * eigener Knopf pro Zeile die Tabelle zumüllt — die Aktion ist umkehrbar
 * und protokolliert, das rechtfertigt den kurzen Weg.
 */
export function RoleSelect({ userId, role }: { userId: string; role: string }) {
  const [state, formAction, pending] = useActionState<UserFormState, FormData>(
    setUserRole,
    {},
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <select
        name="role"
        defaultValue={role}
        disabled={pending}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        aria-label="Rolle"
      >
        <option value={ROLES.USER}>Nutzer</option>
        <option value={ROLES.ADMIN}>Admin</option>
      </select>
      {state.error ? (
        <span className="field-error" style={{ display: "block" }}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
