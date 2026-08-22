"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import {
  changeVersion,
  type VersionFormState,
} from "@/app/(app)/servers/[id]/settings/actions";
import { isDowngrade, softwareSwitchWarning } from "@/lib/mc-version";

export function VersionForm({
  serverId,
  currentVersion,
  currentType,
  variants,
  hasBackups,
}: {
  serverId: string;
  currentVersion: string;
  currentType: string;
  /** Aus dem Spielkatalog — nicht noch einmal hier aufgezählt. */
  variants: { id: string; label: string; hint?: string }[];
  hasBackups: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<VersionFormState, FormData>(
    changeVersion,
    {},
  );

  const [version, setVersion] = useState(currentVersion);
  const [type, setType] = useState(currentType);

  useEffect(() => {
    if (!state.info) return;
    const timer = setTimeout(() => router.refresh(), 5000);
    return () => clearTimeout(timer);
  }, [state.info, router]);

  const downgrade = isDowngrade(currentVersion, version);
  const typeWarning = softwareSwitchWarning(currentType, type);
  const changed = version !== currentVersion || type !== currentType;
  const risky = changed && (downgrade !== false || type !== currentType);

  return (
    <form className="stack" action={action}>
      <input type="hidden" name="serverId" value={serverId} />

      {state.error ? <p className="notice notice-error">{state.error}</p> : null}
      {state.info ? <p className="notice">{state.info}</p> : null}

      <div className="field-grid">
        <div className="field">
          <label htmlFor="serverType">Server-Software</label>
          <select
            id="serverType"
            name="serverType"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            {variants.map((variante) => (
              <option key={variante.id} value={variante.id}>
                {variante.label}
              </option>
            ))}
          </select>
          <span className="hint">Aktuell: {currentType}</span>
        </div>

        <div className="field">
          <label htmlFor="mcVersion">Version</label>
          <input
            id="mcVersion"
            name="mcVersion"
            value={version}
            onChange={(event) => setVersion(event.target.value)}
          />
          <span className="hint">
            Aktuell: {currentVersion}. <code>LATEST</code> oder eine feste
            Version wie <code>1.21.8</code>.
          </span>
        </div>
      </div>

      {downgrade === true ? (
        <p className="notice notice-error">
          <strong>Das ist eine Rückstufung.</strong> Minecraft hat die Welt beim
          Hochstufen umgewandelt und einen höheren Datenstand in{" "}
          <code>level.dat</code> geschrieben. Eine ältere Version weigert sich
          dann zu starten oder lädt die Welt fehlerhaft — einen unterstützten
          Weg zurück gibt es nicht.
        </p>
      ) : null}

      {downgrade === null && changed ? (
        <p className="notice notice-warn">
          Ob das eine Rückstufung ist, lässt sich nicht feststellen — bei{" "}
          <code>LATEST</code> steht die Version erst beim Start fest. Wenn du
          von einer neueren auf eine ältere Version gehst, kann die Welt
          unbrauchbar werden.
        </p>
      ) : null}

      {typeWarning ? (
        <p className="notice notice-warn">{typeWarning}</p>
      ) : null}

      {risky ? (
        <>
          {!hasBackups ? (
            <p className="notice notice-warn">
              Für diesen Server gibt es noch kein Backup.{" "}
              <Link href={`/servers/${serverId}/backups`}>
                Lege zuerst eines an
              </Link>{" "}
              — danach lässt sich der Schritt rückgängig machen.
            </p>
          ) : null}

          <label className="checkbox">
            <input type="checkbox" name="acknowledged" />
            <span>
              Mir ist klar, dass die Weltdaten dabei unbrauchbar werden können
              {hasBackups ? " und ich habe ein Backup" : ""}.
            </span>
          </label>
        </>
      ) : null}

      <button
        className={`btn ${risky ? "btn-danger" : "btn-primary"}`}
        type="submit"
        disabled={pending || !changed}
      >
        {pending
          ? "Wird umgestellt …"
          : changed
            ? "Umstellen und neu starten"
            : "Keine Änderung"}
      </button>

      <p className="hint">
        Der Container wird dabei ersetzt — anders lassen sich Version und
        Software nicht ändern. Die Welt, Plugins und Konfigurationsdateien
        liegen außerhalb des Containers und bleiben unangetastet.
      </p>
    </form>
  );
}
