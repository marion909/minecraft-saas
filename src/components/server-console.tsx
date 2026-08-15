"use client";

import { useActionState } from "react";

import { sendCommand, type ServerFormState } from "@/app/(app)/servers/actions";

export function ServerConsole({
  serverId,
  enabled,
}: {
  serverId: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState<ServerFormState, FormData>(
    sendCommand,
    {},
  );

  return (
    <div className="stack">
      <form className="console-row" action={action}>
        <input type="hidden" name="serverId" value={serverId} />
        <input
          name="command"
          placeholder={enabled ? "say Hallo" : "Server läuft nicht"}
          disabled={!enabled || pending}
          autoComplete="off"
          aria-label="Befehl"
        />
        <button className="btn btn-quiet" type="submit" disabled={!enabled || pending}>
          {pending ? "…" : "Senden"}
        </button>
      </form>

      {state.fields?.command ? (
        <p className="notice notice-warn">{state.fields.command}</p>
      ) : null}
      {state.error ? <p className="notice notice-error">{state.error}</p> : null}
      {state.output ? <pre className="console-out">{state.output}</pre> : null}

      <p className="hint">
        Befehle laufen über RCON, so als stünden sie in der Serverkonsole.
        Jeder Aufruf landet im Prüfprotokoll.
      </p>
    </div>
  );
}
