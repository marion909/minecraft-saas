"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import {
  restartServer,
  startServer,
  stopServer,
  type ServerFormState,
} from "@/app/(app)/servers/actions";

/** Zustände, in denen sich gerade etwas tut und die Anzeige nachziehen muss. */
const TRANSIENT = new Set([
  "PROVISIONING",
  "STARTING",
  "STOPPING",
  "DELETING",
]);

export function ServerControls({
  serverId,
  status,
}: {
  serverId: string;
  status: string;
}) {
  const router = useRouter();

  const [startState, start, starting] = useActionState<ServerFormState, FormData>(
    startServer,
    {},
  );
  const [stopState, stop, stopping] = useActionState<ServerFormState, FormData>(
    stopServer,
    {},
  );
  const [restartState, restart, restarting] = useActionState<
    ServerFormState,
    FormData
  >(restartServer, {});

  const busy = starting || stopping || restarting;
  const inTransition = TRANSIENT.has(status);

  // Während eines Übergangs den Zustand nachladen. Der Agent arbeitet
  // asynchron; ohne das bliebe die Seite auf "wird gestartet" stehen, bis
  // jemand manuell neu lädt.
  useEffect(() => {
    if (!inTransition) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [inTransition, router]);

  const error = startState.error ?? stopState.error ?? restartState.error;

  return (
    <div className="stack">
      {error ? <p className="notice notice-error">{error}</p> : null}

      <div className="actions">
        <form action={start}>
          <input type="hidden" name="serverId" value={serverId} />
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || status === "RUNNING" || inTransition}
          >
            {starting ? "Startet …" : "Starten"}
          </button>
        </form>

        <form action={stop}>
          <input type="hidden" name="serverId" value={serverId} />
          <button
            className="btn btn-quiet"
            type="submit"
            disabled={busy || status !== "RUNNING"}
          >
            {stopping ? "Stoppt …" : "Stoppen"}
          </button>
        </form>

        <form action={restart}>
          <input type="hidden" name="serverId" value={serverId} />
          <button
            className="btn btn-quiet"
            type="submit"
            disabled={busy || status !== "RUNNING"}
          >
            {restarting ? "Startet neu …" : "Neu starten"}
          </button>
        </form>
      </div>

      {inTransition ? (
        <p className="hint">
          Der Vorgang läuft im Hintergrund. Die Anzeige aktualisiert sich
          selbst — beim ersten Start dauert das Laden der Welt gut eine Minute.
        </p>
      ) : null}
    </div>
  );
}
