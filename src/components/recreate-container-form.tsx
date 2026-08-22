"use client";

import { useActionState } from "react";

import {
  recreateContainer,
  type VersionFormState,
} from "@/app/(app)/servers/[id]/settings/actions";

/**
 * Setzt den Container neu auf, ohne die Daten anzufassen.
 *
 * Braucht man, wenn sich am Bauplan etwas geändert hat, das nur beim
 * Anlegen gilt — die veröffentlichten Ports zum Beispiel. Docker kann die
 * an einem bestehenden Container nicht ändern; ein Neustart hilft also
 * nicht, Löschen und Neuanlegen kostet die Installation.
 */
export function RecreateContainerForm({ serverId }: { serverId: string }) {
  const [state, action, pending] = useActionState<VersionFormState, FormData>(
    recreateContainer,
    {},
  );

  return (
    <form className="stack" action={action}>
      <input type="hidden" name="serverId" value={serverId} />

      {state.error ? <p className="notice notice-error">{state.error}</p> : null}
      {state.info ? <p className="notice">{state.info}</p> : null}

      <p className="hint" style={{ maxWidth: "60ch" }}>
        Der Container wird verworfen und aus dem aktuellen Bauplan neu
        gebaut. Das Datenverzeichnis bleibt liegen — Welt, Speicherstände
        und heruntergeladene Spieldateien sind nicht betroffen.
      </p>

      <div className="actions">
        <button className="btn btn-quiet" type="submit" disabled={pending}>
          {pending ? "Wird neu aufgesetzt …" : "Container neu aufsetzen"}
        </button>
      </div>
    </form>
  );
}
