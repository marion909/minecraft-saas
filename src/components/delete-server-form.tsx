"use client";

import { useActionState, useState } from "react";

import { deleteServer, type ServerFormState } from "@/app/(app)/servers/actions";

export function DeleteServerForm({
  serverId,
  serverName,
}: {
  serverId: string;
  serverName: string;
}) {
  const [state, action, pending] = useActionState<ServerFormState, FormData>(
    deleteServer,
    {},
  );
  const [typed, setTyped] = useState("");

  return (
    <form className="stack" action={action}>
      <input type="hidden" name="serverId" value={serverId} />

      {state.error ? <p className="notice notice-error">{state.error}</p> : null}

      <div className="field">
        <label htmlFor="confirmation">
          Tippe <code>{serverName}</code>, um das Löschen zu bestätigen
        </label>
        <input
          id="confirmation"
          name="confirmation"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
        />
        {state.fields?.confirmation ? (
          <span className="field-error">{state.fields.confirmation}</span>
        ) : null}
      </div>

      <button
        className="btn btn-danger"
        type="submit"
        disabled={pending || typed !== serverName}
      >
        {pending ? "Wird gelöscht …" : "Server endgültig löschen"}
      </button>
    </form>
  );
}
