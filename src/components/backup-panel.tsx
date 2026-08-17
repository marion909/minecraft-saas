"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import {
  createBackup,
  deleteBackup,
  restoreBackup,
  type BackupFormState,
} from "@/app/(app)/servers/[id]/backups/actions";

export type BackupEntry = {
  label: string;
  createdAt: string;
  usedBytes: number;
  note: string | null;
};

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export function BackupPanel({
  serverId,
  serverName,
  backups,
  maxBackups,
  incremental,
  busy,
}: {
  serverId: string;
  serverName: string;
  backups: BackupEntry[];
  maxBackups: number;
  /** Bei ZFS kosten Backups nur die Änderungen, sonst die volle Welt. */
  incremental: boolean;
  busy: boolean;
}) {
  const router = useRouter();
  const [createState, create, creating] = useActionState<
    BackupFormState,
    FormData
  >(createBackup, {});
  const [restoreState, restore, restoring] = useActionState<
    BackupFormState,
    FormData
  >(restoreBackup, {});
  const [deleteState, remove, removing] = useActionState<
    BackupFormState,
    FormData
  >(deleteBackup, {});

  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  // Nach dem Anstoßen arbeitet der Agent im Hintergrund; die Liste zieht nach.
  useEffect(() => {
    if (!createState.info && !restoreState.info) return;
    const timer = setTimeout(() => router.refresh(), 4000);
    return () => clearTimeout(timer);
  }, [createState.info, restoreState.info, router]);

  const notice = createState.info ?? restoreState.info ?? deleteState.info;
  const error = createState.error ?? restoreState.error ?? deleteState.error;

  return (
    <div className="stack">
      {error ? <p className="notice notice-error">{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <div className="actions">
        <form action={create}>
          <input type="hidden" name="serverId" value={serverId} />
          <button
            className="btn btn-primary"
            type="submit"
            disabled={creating || busy}
          >
            {creating ? "Backup läuft …" : "Backup erstellen"}
          </button>
        </form>
        <span className="hint">
          {backups.length} von {maxBackups} belegt
          {backups.length >= maxBackups && maxBackups > 0
            ? " — das älteste wird beim nächsten Mal ersetzt"
            : ""}
        </span>
      </div>

      {backups.length === 0 ? (
        <div className="empty">
          <p style={{ margin: 0 }}>Noch kein Backup vorhanden.</p>
          <p className="hint" style={{ maxWidth: "36rem" }}>
            Der Server bleibt während eines Backups erreichbar. Er hält nur
            kurz das Schreiben an, damit die Welt vollständig auf der Platte
            liegt.
          </p>
        </div>
      ) : (
        <div className="scroller">
          <table>
            <thead>
              <tr>
                <th>Zeitpunkt</th>
                <th>Größe</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {backups.map((backup) => (
                <tr key={backup.label}>
                  <td>
                    {new Date(backup.createdAt).toLocaleString("de-DE")}
                    <br />
                    <code style={{ fontSize: "0.7rem" }}>{backup.label}</code>
                  </td>
                  <td className="num">{size(backup.usedBytes)}</td>
                  <td>
                    <div className="actions">
                      {/*
                        Ein gewöhnlicher Link, kein Knopf mit fetch: Der
                        Browser lädt die Datei dann selbst herunter, mit
                        Fortschritt und Wiederaufnahme, und nichts davon
                        muss durch den Arbeitsspeicher der Seite.
                      */}
                      <a
                        className="btn btn-quiet btn-small"
                        href={`/api/servers/${serverId}/backups/${encodeURIComponent(backup.label)}`}
                        download
                      >
                        Herunterladen
                      </a>

                      <button
                        className="btn btn-quiet btn-small"
                        type="button"
                        disabled={busy || restoring}
                        onClick={() => {
                          setConfirmFor(
                            confirmFor === backup.label ? null : backup.label,
                          );
                          setTyped("");
                        }}
                      >
                        Zurückspielen
                      </button>

                      <form action={remove}>
                        <input type="hidden" name="serverId" value={serverId} />
                        <input type="hidden" name="label" value={backup.label} />
                        <button
                          className="btn btn-quiet btn-small"
                          type="submit"
                          disabled={removing || busy}
                        >
                          Löschen
                        </button>
                      </form>
                    </div>

                    {confirmFor === backup.label ? (
                      <form className="stack restore-confirm" action={restore}>
                        <input type="hidden" name="serverId" value={serverId} />
                        <input type="hidden" name="label" value={backup.label} />
                        <p className="notice notice-warn">
                          Alles, was seit diesem Backup passiert ist, geht
                          verloren — Bauten, Fortschritt, Inventare. Der Server
                          wird dafür gestoppt und danach wieder gestartet.
                        </p>
                        <div className="field">
                          <label htmlFor={`confirm-${backup.label}`}>
                            Zum Bestätigen <code>{serverName}</code> eingeben
                          </label>
                          <input
                            id={`confirm-${backup.label}`}
                            name="confirmation"
                            value={typed}
                            onChange={(event) => setTyped(event.target.value)}
                            autoComplete="off"
                          />
                        </div>
                        <button
                          className="btn btn-danger"
                          type="submit"
                          disabled={restoring || typed !== serverName}
                        >
                          {restoring ? "Wird zurückgespielt …" : "Jetzt zurückspielen"}
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="hint" style={{ maxWidth: "60ch" }}>
        {incremental
          ? "Backups sind Snapshots: Sie kosten nur den Platz der Änderungen und sind in Sekunden fertig."
          : "Auf diesem Node werden vollständige Archive angelegt — sie brauchen so viel Platz wie die Welt selbst und dauern entsprechend."}{" "}
        Sie liegen auf derselben Platte wie der Server und schützen damit gegen
        Griefing und kaputte Plugins, nicht gegen einen Plattenausfall. Dagegen
        hilft nur, sie herunterzuladen.
      </p>
    </div>
  );
}
