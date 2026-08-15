/**
 * Auswertung von `docker stats`.
 *
 * Docker liefert Rohzähler, keine Prozentwerte — die Umrechnung ist der
 * Teil, den man leicht falsch macht. Deshalb hier als reine Funktion.
 */

export type DockerStats = {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
  };
  memory_stats?: {
    usage?: number;
    limit?: number;
    stats?: Record<string, number>;
  };
};

export type ResourceSample = {
  /** Auslastung in Prozent eines Kerns; 200 heißt zwei Kerne voll. */
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
};

export function computeSample(stats: DockerStats): ResourceSample {
  const cpuPercent = computeCpuPercent(stats);
  const memoryBytes = computeMemoryBytes(stats);
  const memoryLimitBytes = stats.memory_stats?.limit ?? 0;

  return {
    cpuPercent,
    memoryBytes,
    memoryLimitBytes,
    memoryPercent:
      memoryLimitBytes > 0
        ? round((memoryBytes / memoryLimitBytes) * 100)
        : 0,
  };
}

function computeCpuPercent(stats: DockerStats): number {
  const current = stats.cpu_stats?.cpu_usage?.total_usage ?? 0;
  const systemCurrent = stats.cpu_stats?.system_cpu_usage ?? 0;
  const previous = stats.precpu_stats?.cpu_usage?.total_usage;
  const systemPrevious = stats.precpu_stats?.system_cpu_usage;

  // Die allererste Messung eines Streams hat keinen Vorgänger — Docker
  // liefert dann leere oder auf null stehende precpu_stats. Würde man das
  // als Differenz zu null rechnen, käme die gesamte bisherige Laufzeit des
  // Containers als "Auslastung seit der letzten Messung" heraus, also
  // regelmäßig 100 % und mehr. Der erste Wert ist deshalb kein Messwert.
  if (!previous || !systemPrevious) return 0;

  const cpuDelta = current - previous;
  const systemDelta = systemCurrent - systemPrevious;

  if (cpuDelta <= 0 || systemDelta <= 0) return 0;

  const cores =
    stats.cpu_stats?.online_cpus ??
    stats.cpu_stats?.cpu_usage?.percpu_usage?.length ??
    1;

  return round((cpuDelta / systemDelta) * cores * 100);
}

/**
 * Der gemeldete Speicher enthält den Dateicache, den der Kernel jederzeit
 * freigeben kann. Ihn mitzuzählen ließe jeden Server so aussehen, als sei
 * er am Limit — bei einer JVM, die viel von der Platte liest, dauerhaft.
 */
function computeMemoryBytes(stats: DockerStats): number {
  const usage = stats.memory_stats?.usage ?? 0;
  const detail = stats.memory_stats?.stats ?? {};

  // cgroup v2 nennt es inactive_file, cgroup v1 cache.
  const reclaimable = detail.inactive_file ?? detail.cache ?? 0;

  return Math.max(0, usage - reclaimable);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Verteilt die Messwerte eines Containers an beliebig viele Zuschauer.
 *
 * Wichtig für den Betrieb: Docker bekommt genau einen Stats-Stream pro
 * Container, egal wie viele Browser-Tabs offen sind. Ein Stream pro Tab
 * bringt den Daemon bei ein paar Dutzend Servern in Schwierigkeiten.
 */
export class SampleFanout {
  #listeners = new Set<(sample: ResourceSample) => void>();
  #stop: (() => void) | null = null;
  #last: ResourceSample | null = null;

  // Ausgeschrieben statt als Parameter-Property: Node führt diese Dateien
  // direkt aus und strippt dabei nur Typen.
  private readonly startSource: (
    emit: (sample: ResourceSample) => void,
  ) => () => void;

  constructor(
    startSource: (emit: (sample: ResourceSample) => void) => () => void,
  ) {
    this.startSource = startSource;
  }

  subscribe(listener: (sample: ResourceSample) => void): () => void {
    this.#listeners.add(listener);

    // Sofort den letzten bekannten Wert liefern, damit die Anzeige nicht
    // bis zur nächsten Messung leer bleibt.
    if (this.#last) listener(this.#last);

    if (this.#listeners.size === 1) {
      this.#stop = this.startSource((sample) => {
        this.#last = sample;
        for (const target of this.#listeners) target(sample);
      });
    }

    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        this.#stop?.();
        this.#stop = null;
      }
    };
  }

  get listenerCount(): number {
    return this.#listeners.size;
  }
}
