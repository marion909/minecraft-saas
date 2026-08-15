"use client";

import { useActionState, useState } from "react";

import {
  saveFile,
  type FileFormState,
} from "@/app/(app)/servers/[id]/files/actions";

export function FileEditor({
  serverId,
  path,
  initial,
}: {
  serverId: string;
  path: string;
  initial: string;
}) {
  const [state, action, pending] = useActionState<FileFormState, FormData>(
    saveFile,
    {},
  );
  const [content, setContent] = useState(initial);
  const dirty = content !== initial;

  return (
    <form className="stack" action={action}>
      <input type="hidden" name="serverId" value={serverId} />
      <input type="hidden" name="path" value={path} />

      {state.error ? <p className="notice notice-error">{state.error}</p> : null}
      {state.saved ? (
        <p className="notice">
          Gespeichert. Für die meisten Dateien wirkt das erst nach einem
          Neustart des Servers.
        </p>
      ) : null}

      <textarea
        className="file-editor"
        name="content"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        spellCheck={false}
        rows={24}
        aria-label={`Inhalt von ${path}`}
      />

      <div className="actions">
        <button className="btn btn-primary" type="submit" disabled={pending || !dirty}>
          {pending ? "Wird gespeichert …" : "Speichern"}
        </button>
        {dirty ? (
          <button
            className="btn btn-quiet"
            type="button"
            onClick={() => setContent(initial)}
          >
            Änderungen verwerfen
          </button>
        ) : null}
      </div>
    </form>
  );
}
