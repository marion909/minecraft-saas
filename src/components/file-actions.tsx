"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";

import {
  createDirectory,
  deleteFile,
  type FileFormState,
} from "@/app/(app)/servers/[id]/files/actions";

/**
 * Zwei Rollen in einer Komponente: In der Kopfzeile Anlegen und Hochladen,
 * in einer Tabellenzeile nur die Löschen-Schaltfläche für den Eintrag.
 */
export function FileActions({
  serverId,
  path,
  deleteTarget,
}: {
  serverId: string;
  path: string;
  deleteTarget?: string;
}) {
  const router = useRouter();
  const [removeState, remove, removing] = useActionState<
    FileFormState,
    FormData
  >(deleteFile, {});

  if (deleteTarget) {
    return (
      <form
        action={remove}
        onSubmit={(event) => {
          if (
            !window.confirm(
              `„${deleteTarget}“ löschen? Ordner werden mit allem Inhalt entfernt.`,
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="serverId" value={serverId} />
        <input type="hidden" name="path" value={deleteTarget} />
        <button className="btn btn-quiet btn-small" type="submit" disabled={removing}>
          {removing ? "…" : "Löschen"}
        </button>
      </form>
    );
  }

  return <Toolbar serverId={serverId} path={path} router={router} />;
}

function Toolbar({
  serverId,
  path,
  router,
}: {
  serverId: string;
  path: string;
  router: ReturnType<typeof useRouter>;
}) {
  const [mkdirState, mkdir, creating] = useActionState<FileFormState, FormData>(
    createDirectory,
    {},
  );
  const [folder, setFolder] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true);
    setUploadError(null);

    const target = path ? `${path}/${file.name}` : file.name;

    try {
      const response = await fetch(
        `/api/servers/${serverId}/upload?path=${encodeURIComponent(target)}`,
        { method: "POST", body: file },
      );

      if (!response.ok) {
        const text = await response.text();
        setUploadError(
          text.startsWith("{")
            ? ((JSON.parse(text) as { error?: string }).error ??
              "Upload fehlgeschlagen.")
            : text || "Upload fehlgeschlagen.",
        );
        return;
      }

      router.refresh();
    } catch {
      setUploadError("Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="stack">
      {mkdirState.error ? (
        <p className="notice notice-error">{mkdirState.error}</p>
      ) : null}
      {uploadError ? <p className="notice notice-error">{uploadError}</p> : null}

      <div className="file-toolbar">
        <form className="inline-form" action={mkdir}>
          <input type="hidden" name="serverId" value={serverId} />
          <input
            type="hidden"
            name="path"
            value={path ? `${path}/${folder}` : folder}
          />
          <input
            aria-label="Ordnername"
            placeholder="Neuer Ordner"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
          />
          <button
            className="btn btn-quiet btn-small"
            type="submit"
            disabled={creating || folder.trim().length === 0}
          >
            Anlegen
          </button>
        </form>

        <label className="btn btn-quiet btn-small upload-label">
          {uploading ? "Wird hochgeladen …" : "Datei hochladen"}
          <input
            ref={fileInput}
            type="file"
            hidden
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
      </div>

      <p className="hint">
        Plugins gehören nach <code>plugins/</code>, Mods nach <code>mods/</code>.
        Nach dem Hochladen muss der Server neu gestartet werden.
      </p>
    </div>
  );
}
