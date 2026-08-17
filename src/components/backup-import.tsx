"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Zustand =
  | { art: "bereit" }
  | { art: "lädt"; prozent: number }
  | { art: "läuft"; text: string }
  | { art: "fehler"; text: string };

/**
 * Ein Backup-Archiv hochladen und einspielen.
 *
 * Bewusst über XMLHttpRequest statt fetch: Nur damit gibt es einen
 * Fortschritt beim Hochladen. Ein Weltarchiv kann Hunderte Megabyte
 * haben, und eine Minute ohne jede Rückmeldung sieht aus wie ein
 * Absturz — dann lädt jemand ein zweites Mal.
 */
export function BackupImport({
  serverId,
  serverName,
  disabled,
}: {
  serverId: string;
  serverName: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [zustand, setZustand] = useState<Zustand>({ art: "bereit" });
  const [datei, setDatei] = useState<File | null>(null);
  const [bestätigung, setBestätigung] = useState("");
  const eingabe = useRef<HTMLInputElement>(null);

  const bestätigt = bestätigung.trim() === serverName;
  const beschäftigt = zustand.art === "lädt" || zustand.art === "läuft";

  function hochladen() {
    if (!datei || !bestätigt) return;

    const anfrage = new XMLHttpRequest();
    anfrage.open("POST", `/api/servers/${serverId}/backups/import`);
    anfrage.setRequestHeader("content-type", "application/octet-stream");

    anfrage.upload.addEventListener("progress", (ereignis) => {
      if (!ereignis.lengthComputable) return;
      setZustand({
        art: "lädt",
        prozent: Math.round((ereignis.loaded / ereignis.total) * 100),
      });
    });

    anfrage.addEventListener("load", () => {
      if (anfrage.status >= 200 && anfrage.status < 300) {
        setZustand({
          art: "läuft",
          text:
            "Hochgeladen. Der Agent prüft das Archiv, hält den Server an und " +
            "spielt es ein. Vorher legt er eine Sicherung des jetzigen " +
            "Standes an — die steht gleich in der Liste.",
        });
        setDatei(null);
        setBestätigung("");
        if (eingabe.current) eingabe.current.value = "";
        setTimeout(() => router.refresh(), 4000);
      } else {
        setZustand({
          art: "fehler",
          text: anfrage.responseText || `Fehlgeschlagen (${anfrage.status}).`,
        });
      }
    });

    anfrage.addEventListener("error", () =>
      setZustand({
        art: "fehler",
        text: "Die Verbindung ist abgebrochen. Nichts wurde verändert.",
      }),
    );

    setZustand({ art: "lädt", prozent: 0 });
    anfrage.send(datei);
  }

  return (
    <div className="stack">
      {zustand.art === "fehler" ? (
        <p className="notice notice-error">{zustand.text}</p>
      ) : null}
      {zustand.art === "läuft" ? (
        <p className="notice">{zustand.text}</p>
      ) : null}

      <p className="muted" style={{ maxWidth: "62ch" }}>
        Ein Archiv aus dem Herunterladen-Knopf — auch von einem anderen Server
        oder aus einer Sicherung von der eigenen Platte. Der Inhalt{" "}
        <strong>ersetzt die Welt vollständig</strong>. Vor dem Einspielen legt
        der Agent automatisch ein Backup des jetzigen Standes an, damit der Weg
        zurück offen bleibt.
      </p>

      <div className="field">
        <label htmlFor="archiv">Archiv (.tar.gz)</label>
        <input
          id="archiv"
          ref={eingabe}
          type="file"
          accept=".gz,.tgz,application/gzip,application/x-gzip"
          disabled={disabled || beschäftigt}
          onChange={(ereignis) => {
            setDatei(ereignis.target.files?.[0] ?? null);
            setZustand({ art: "bereit" });
          }}
        />
        {datei ? (
          <span className="hint">
            {datei.name} · {(datei.size / 1024 / 1024).toFixed(1)} MB
          </span>
        ) : (
          <span className="hint">
            Erwartet wird ein <code>.tar.gz</code>, wie es der
            Herunterladen-Knopf erzeugt. Symbolische Verweise, Pfade mit{" "}
            <code>..</code> und alles, was kein Verzeichnis oder keine Datei
            ist, werden abgelehnt.
          </span>
        )}
      </div>

      {datei ? (
        <div className="field" style={{ maxWidth: "24rem" }}>
          <label htmlFor="import-confirm">
            Zum Bestätigen <code>{serverName}</code> eingeben
          </label>
          <input
            id="import-confirm"
            value={bestätigung}
            onChange={(ereignis) => setBestätigung(ereignis.target.value)}
            autoComplete="off"
            disabled={beschäftigt}
          />
        </div>
      ) : null}

      {zustand.art === "lädt" ? (
        <div className="meter">
          <div className="meter-head">
            <span>Hochladen</span>
            <span className="num">{zustand.prozent} %</span>
          </div>
          <div className="meter-track">
            <div
              className="meter-fill meter-busy"
              style={{ width: `${zustand.prozent}%` }}
            />
          </div>
        </div>
      ) : null}

      <div className="actions">
        <button
          className="btn btn-danger"
          type="button"
          disabled={disabled || !datei || !bestätigt || beschäftigt}
          onClick={hochladen}
        >
          {zustand.art === "lädt"
            ? `Lädt … ${zustand.prozent} %`
            : "Hochladen und einspielen"}
        </button>
      </div>
    </div>
  );
}
