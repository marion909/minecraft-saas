"use client";

import { useActionState, useState } from "react";

import {
  powerNode,
  type HostPowerState,
} from "@/app/(app)/admin/host/actions";

/**
 * Neustart und Herunterfahren eines Hosts.
 *
 * Die Sicherung ist der abgetippte Node-Name, nicht ein Dialog: Ein
 * „Wirklich?“ klickt man weg, ohne es zu lesen. Einen Namen abzutippen
 * zwingt dazu, vorher hinzusehen, welcher Host gemeint ist — und genau
 * darauf kommt es an, sobald es mehr als einen gibt.
 */
export function HostPowerForm({
  nodeId,
  nodeName,
  runningServers,
  canPower,
  powerError,
  panelLikelyHere,
}: {
  nodeId: string;
  nodeName: string;
  runningServers: number;
  canPower: boolean;
  powerError: string | null;
  panelLikelyHere: boolean;
}) {
  const [state, formAction, pending] = useActionState<HostPowerState, FormData>(
    powerNode,
    {},
  );
  const [confirmation, setConfirmation] = useState("");

  const bestätigt = confirmation.trim() === nodeName;

  if (!canPower) {
    return (
      <p className="notice notice-warn">
        Dieser Agent darf den Host nicht schalten.
        {powerError ? ` ${powerError}` : ""} Nachrüsten mit{" "}
        <code>sudo deploy/update.sh</code> auf dem Host — das legt den Helfer
        an und ergänzt die sudo-Regel.
      </p>
    );
  }

  return (
    <form className="stack" action={formAction}>
      <input type="hidden" name="nodeId" value={nodeId} />

      {state.error ? <p className="notice notice-error">{state.error}</p> : null}
      {state.message ? <p className="notice">{state.message}</p> : null}

      <p className="muted" style={{ maxWidth: "62ch" }}>
        Vor dem Schalten hält der Agent alle laufenden Server einzeln an und
        lässt jede Welt speichern.{" "}
        {runningServers > 0 ? (
          <>
            Betroffen sind gerade <strong>{runningServers}</strong>{" "}
            {runningServers === 1 ? "laufender Server" : "laufende Server"} —
            deren Spieler fliegen dabei heraus.
          </>
        ) : (
          <>Gerade läuft kein Server.</>
        )}{" "}
        Das dauert pro Server bis zu zwei Minuten. Ein blankes{" "}
        <code>reboot</code> auf der Kommandozeile täte das nicht: Docker gibt
        den Containern beim Herunterfahren nur Sekunden, und was dann noch
        nicht geschrieben war, fehlt in der Welt.
      </p>

      {panelLikelyHere ? (
        <p className="notice notice-warn">
          Das Panel läuft aller Wahrscheinlichkeit nach auf genau diesem Host.
          Mit dem Neustart verschwindet also auch diese Seite — sie kommt von
          allein zurück, sobald der Host wieder da ist. Beim Herunterfahren
          nicht.
        </p>
      ) : null}

      <div className="field" style={{ maxWidth: "24rem" }}>
        <label htmlFor={`confirm-${nodeId}`}>
          Zum Bestätigen <code>{nodeName}</code> eintippen
        </label>
        <input
          id={`confirm-${nodeId}`}
          name="confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={nodeName}
        />
      </div>

      <div className="actions">
        <button
          className="btn btn-danger"
          type="submit"
          name="mode"
          value="reboot"
          disabled={!bestätigt || pending}
        >
          {pending ? "…" : "Neu starten"}
        </button>
        <button
          className="btn btn-danger"
          type="submit"
          name="mode"
          value="poweroff"
          disabled={!bestätigt || pending}
        >
          {pending ? "…" : "Herunterfahren"}
        </button>
      </div>

      <p className="hint">
        Herunterfahren heißt: Der Host bleibt aus, bis ihn jemand vor Ort
        wieder einschaltet.
      </p>
    </form>
  );
}
