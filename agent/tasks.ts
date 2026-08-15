import { randomUUID } from "node:crypto";

export type TaskStatus = "running" | "done" | "failed";

export type Task = {
  id: string;
  kind: string;
  serverId: string | null;
  status: TaskStatus;
  progress: string[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

/**
 * Registry für Vorgänge, die länger dauern als eine HTTP-Anfrage — vor allem
 * das Ziehen des Images beim ersten Server.
 *
 * Bewusst nur im Speicher: Nach einem Neustart des Agents sind die Einträge
 * weg. Das ist vertretbar, weil der wahre Zustand ohnehin immer aus Docker
 * gelesen wird und der Abgleich (reconcile) ihn wiederherstellt. Ein Task ist
 * eine Fortschrittsanzeige, keine Quelle der Wahrheit.
 */
export class TaskRegistry {
  #tasks = new Map<string, Task>();
  #order: string[] = [];

  private readonly keep: number;

  constructor(keep = 200) {
    this.keep = keep;
  }

  start(
    kind: string,
    serverId: string | null,
    work: (report: (line: string) => void) => Promise<void>,
  ): Task {
    const task: Task = {
      id: randomUUID(),
      kind,
      serverId,
      status: "running",
      progress: [],
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };

    this.#tasks.set(task.id, task);
    this.#order.push(task.id);
    this.#prune();

    const report = (line: string) => {
      // Nur die letzten Zeilen behalten; ein Image-Pull erzeugt Tausende.
      task.progress.push(line);
      if (task.progress.length > 50) task.progress.shift();
    };

    void work(report)
      .then(() => {
        task.status = "done";
      })
      .catch((error: unknown) => {
        task.status = "failed";
        task.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        task.finishedAt = new Date().toISOString();
      });

    return task;
  }

  get(id: string): Task | undefined {
    return this.#tasks.get(id);
  }

  list(): Task[] {
    return this.#order
      .map((id) => this.#tasks.get(id))
      .filter((task): task is Task => task !== undefined)
      .reverse();
  }

  /** Läuft für diesen Server bereits etwas? Verhindert Doppelaufträge. */
  runningFor(serverId: string): Task | undefined {
    return this.list().find(
      (task) => task.serverId === serverId && task.status === "running",
    );
  }

  /**
   * Alles, was gerade läuft — über alle Server hinweg. Gebraucht wird das
   * vor dem Schalten des Hosts: Ein Neustart mitten in einem Backup lässt
   * einen Server im save-off-Zustand zurück, und der verliert dann beim
   * nächsten Absturz alles seit dem letzten Snapshot.
   */
  running(): Task[] {
    return this.list().filter((task) => task.status === "running");
  }

  #prune(): void {
    while (this.#order.length > this.keep) {
      const oldest = this.#order.shift();
      if (oldest) this.#tasks.delete(oldest);
    }
  }
}
