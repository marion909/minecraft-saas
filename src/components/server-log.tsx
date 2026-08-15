"use client";

import { useEffect, useRef, useState } from "react";

type Line = { id: number; text: string; level: "info" | "warn" | "error" };

/** Ältere Zeilen fallen heraus — sonst wächst der DOM ohne Grenze. */
const MAX_LINES = 500;

export function ServerLog({ serverId }: { serverId: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [connected, setConnected] = useState(false);
  const [follow, setFollow] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(0);

  useEffect(() => {
    const source = new EventSource(`/api/servers/${serverId}/logs?tail=200`);

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    source.addEventListener("line", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        text: string;
        level: Line["level"];
      };

      setLines((current) => {
        const next = [
          ...current,
          { id: nextId.current++, text: payload.text, level: payload.level },
        ];
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    });

    return () => source.close();
  }, [serverId]);

  useEffect(() => {
    if (!follow) return;
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lines, follow]);

  return (
    <div className="stack">
      <div className="log-toolbar">
        <span className={`chip chip-${connected ? "ok" : "off"}`}>
          {connected ? "verbunden" : "getrennt"}
        </span>
        <label className="log-follow">
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => setFollow(event.target.checked)}
          />
          Automatisch mitscrollen
        </label>
        <button
          className="btn btn-quiet btn-small"
          type="button"
          onClick={() => setLines([])}
        >
          Leeren
        </button>
      </div>

      <div
        className="log-box"
        ref={boxRef}
        // Wer selbst hochscrollt, will lesen — dann nicht dazwischenfunken.
        onScroll={(event) => {
          const box = event.currentTarget;
          const atBottom =
            box.scrollHeight - box.scrollTop - box.clientHeight < 40;
          if (atBottom !== follow) setFollow(atBottom);
        }}
        role="log"
        aria-live="polite"
        aria-label="Server-Log"
      >
        {lines.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            Warte auf Ausgaben …
          </p>
        ) : (
          lines.map((line) => (
            <div className={`log-line log-${line.level}`} key={line.id}>
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
