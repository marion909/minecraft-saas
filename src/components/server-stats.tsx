"use client";

import { useEffect, useState } from "react";

type Sample = {
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
};

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Ampel: ab 75 % Vorwarnung, ab 90 % kritisch. */
function tone(percent: number): string {
  if (percent >= 90) return "bad";
  if (percent >= 75) return "busy";
  return "ok";
}

export function ServerStats({
  serverId,
  cpuCores,
}: {
  serverId: string;
  cpuCores: number;
}) {
  const [sample, setSample] = useState<Sample | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const source = new EventSource(`/api/servers/${serverId}/stats`);

    source.onerror = () => setError(true);
    source.addEventListener("sample", (event) => {
      setError(false);
      setSample(JSON.parse((event as MessageEvent<string>).data) as Sample);
    });

    return () => source.close();
  }, [serverId]);

  if (error && !sample) {
    return <p className="hint">Messwerte sind gerade nicht verfügbar.</p>;
  }

  if (!sample) {
    return <p className="hint">Messwerte werden geladen …</p>;
  }

  // Der Container darf mehrere Kerne nutzen; 100 % heißt ein Kern voll.
  // Für den Balken zählt der Anteil an dem, was der Tarif erlaubt.
  const cpuOfQuota = Math.min(
    100,
    (sample.cpuPercent / (cpuCores * 100)) * 100,
  );

  return (
    <div className="meters">
      <div className="meter">
        <div className="meter-head">
          <span>CPU</span>
          <span className="num">
            {sample.cpuPercent.toFixed(1)} % von {cpuCores * 100} %
          </span>
        </div>
        <div className="meter-track">
          <div
            className={`meter-fill meter-${tone(cpuOfQuota)}`}
            style={{ width: `${cpuOfQuota}%` }}
          />
        </div>
      </div>

      <div className="meter">
        <div className="meter-head">
          <span>Arbeitsspeicher</span>
          <span className="num">
            {gb(sample.memoryBytes)} von {gb(sample.memoryLimitBytes)}
          </span>
        </div>
        <div className="meter-track">
          <div
            className={`meter-fill meter-${tone(sample.memoryPercent)}`}
            style={{ width: `${Math.min(100, sample.memoryPercent)}%` }}
          />
        </div>
      </div>

      <p className="hint">
        Der Arbeitsspeicher zählt ohne Dateicache — den gibt der Kernel bei
        Bedarf von selbst frei. Nähert sich der Wert dem Limit, ist der Tarif
        zu klein.
      </p>
    </div>
  );
}
