import "server-only";

import type { Node } from "@/generated/prisma/client";

/**
 * Client für den Node-Agent. Der Agent lauscht nur lokal und hat den
 * Docker-Socket — die App spricht ihn ausschließlich über diese Schicht an,
 * nie direkt mit Docker.
 *
 * `server-only` oben ist Absicht: Ein versehentlicher Import in einer
 * Client-Komponente würde das Agent-Token ins Browser-Bundle tragen und
 * bricht deshalb schon beim Bauen.
 */

export type AgentServerState = {
  serverId: string;
  status:
    | "absent"
    | "created"
    | "starting"
    | "running"
    | "stopping"
    | "stopped"
    | "failed";
  containerId: string | null;
  containerRunning: boolean;
  ready: boolean;
  exitCode: number | null;
  startedAt: string | null;
  usage: { usedBytes: number; quotaBytes: number | null } | null;
  storage: "zfs" | "directory";
};

export type AgentTask = {
  id: string;
  kind: string;
  serverId: string | null;
  status: "running" | "done" | "failed";
  progress: string[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

/** Antwort von GET /host — der Zustand des Linux-Hosts hinter dem Agent. */
export type AgentHostInfo = {
  hostname: string;
  kernel: string;
  uptimeSeconds: number;
  cpuCount: number;
  loadAverage: [number, number, number];
  memory: { totalMb: number; availableMb: number; source: "meminfo" | "os" };
  disk: { path: string; totalMb: number; freeMb: number } | null;
  rebootRequired: { required: boolean; packages: string[] };
  canPower: boolean;
  powerError: string | null;
  containers: { total: number; running: number };
  busy: { id: string; kind: string; serverId: string | null }[];
};

export type CreateServerInput = {
  serverId: string;
  subdomain: string;
  serverType: string;
  mcVersion: string;
  memoryMb: number;
  cpuCores: number;
  diskMb: number;
  maxPlayers: number;
  rconPassword: string;
  hostname: string;
};

export class AgentError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class AgentClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  static forNode(node: Pick<Node, "agentUrl" | "agentToken">): AgentClient {
    return new AgentClient(node.agentUrl, node.agentToken);
  }

  /**
   * Zeitgrenze für jede Anfrage.
   *
   * Ein Node mit gefiltertem Port antwortet nicht mit einem Fehler, er
   * antwortet gar nicht — ohne Grenze bliebe die Seite hängen, bis der
   * Browser aufgibt. Alle Endpunkte hier antworten sofort; was länger
   * dauert, läuft beim Agent als Vorgang und wird nachgefragt.
   */
  static readonly TIMEOUT_MS = 30_000;

  async #request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs: number = AgentClient.TIMEOUT_MS,
  ): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // Zeitüberschreitung und abgewiesene Verbindung getrennt melden:
      // Das eine heißt "Dienst läuft nicht", das andere meist "Firewall
      // verschluckt die Pakete" — und das sind zwei verschiedene Abende.
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new AgentError(
          504,
          `Node-Agent antwortet nicht innerhalb von ${Math.round(timeoutMs / 1000)} s ` +
            `(${this.baseUrl}). Erreichbar, aber stumm — meist eine Firewall dazwischen.`,
        );
      }

      // Der Agent ist ein eigener Prozess; ist er aus, muss das Panel das
      // als solches melden und nicht als Serverfehler des Nutzers.
      throw new AgentError(
        503,
        `Node-Agent nicht erreichbar (${this.baseUrl}). Läuft der Dienst?`,
      );
    }

    const text = await response.text();
    const payload: unknown = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const message =
        (payload as { error?: string }).error ?? `Agent antwortete ${response.status}.`;
      throw new AgentError(response.status, message);
    }

    return payload as T;
  }

  /**
   * Kurze Grenze: Diese Abfrage steht in Übersichten, oft mehrfach
   * nebeneinander. Ein toter Node darf die Seite nicht aufhalten.
   */
  health() {
    return this.#request<{
      ok: boolean;
      docker: { ok: boolean; error: string | null };
      storage: { kind: "zfs" | "directory"; hardQuota: boolean };
      network: string;
      image?: string;
    }>("GET", "/health", undefined, 6000);
  }

  // --- Der Host ---------------------------------------------------------

  hostInfo() {
    return this.#request<AgentHostInfo>("GET", "/host", undefined, 8000);
  }

  /**
   * Schaltet den Host — nachdem der Agent die genannten Server sauber
   * angehalten hat. Die RCON-Passwörter gehen deshalb mit: Nur die
   * Datenbank kennt sie, und ohne sie kann der Agent keine Welt
   * speichern lassen.
   */
  power(
    mode: "reboot" | "poweroff",
    servers: { serverId: string; rconPassword: string }[],
  ) {
    return this.#request<{ task: AgentTask; servers: number }>(
      "POST",
      "/host/power",
      { mode, servers },
    );
  }

  getServer(serverId: string) {
    return this.#request<AgentServerState>("GET", `/servers/${serverId}`);
  }

  createServer(input: CreateServerInput) {
    return this.#request<{ task: AgentTask }>("POST", "/servers", input);
  }

  start(serverId: string, rconPassword: string) {
    return this.#request<{ task?: AgentTask; alreadyRunning?: boolean }>(
      "POST",
      `/servers/${serverId}/start`,
      { rconPassword },
    );
  }

  stop(serverId: string, rconPassword: string) {
    return this.#request<{ task: AgentTask }>(
      "POST",
      `/servers/${serverId}/stop`,
      { rconPassword },
    );
  }

  restart(serverId: string, rconPassword: string) {
    return this.#request<{ task: AgentTask }>(
      "POST",
      `/servers/${serverId}/restart`,
      { rconPassword },
    );
  }

  remove(serverId: string, rconPassword?: string) {
    return this.#request<{ task: AgentTask }>(
      "DELETE",
      `/servers/${serverId}`,
      { rconPassword },
    );
  }

  command(serverId: string, rconPassword: string, command: string) {
    return this.#request<{ output: string }>(
      "POST",
      `/servers/${serverId}/command`,
      { rconPassword, command },
    );
  }

  getTask(taskId: string) {
    return this.#request<AgentTask>("GET", `/tasks/${taskId}`);
  }

  // --- Dateien ---------------------------------------------------------

  listFiles(serverId: string, path: string) {
    return this.#request<{
      path: string;
      entries: {
        name: string;
        type: "file" | "directory" | "other";
        sizeBytes: number;
        modifiedAt: string;
        editable: boolean;
      }[];
      truncated: boolean;
    }>("GET", `/servers/${serverId}/files?path=${encodeURIComponent(path)}`);
  }

  readFile(serverId: string, path: string) {
    return this.#request<
      | { kind: "text"; path: string; content: string; sizeBytes: number }
      | { kind: "binary"; path: string; sizeBytes: number }
      | { kind: "too-large"; path: string; sizeBytes: number }
    >("GET", `/servers/${serverId}/file?path=${encodeURIComponent(path)}`);
  }

  writeFile(serverId: string, path: string, content: string) {
    return this.#request<{ path: string; sizeBytes: number }>(
      "PUT",
      `/servers/${serverId}/file`,
      { path, content },
    );
  }

  deleteFile(serverId: string, path: string) {
    return this.#request<{ path: string }>("DELETE", `/servers/${serverId}/file`, {
      path,
    });
  }

  makeDirectory(serverId: string, path: string) {
    return this.#request<{ path: string }>(
      "POST",
      `/servers/${serverId}/files/mkdir`,
      { path },
    );
  }

  /**
   * Erstellt den Container mit geänderten Eckdaten neu. Die Weltdaten
   * bleiben; sie liegen als Bind-Mount außerhalb des Containers.
   */
  recreate(input: {
    serverId: string;
    subdomain: string;
    serverType: string;
    mcVersion: string;
    memoryMb: number;
    cpuCores: number;
    maxPlayers: number;
    rconPassword: string;
    start: boolean;
  }) {
    const { serverId, ...rest } = input;
    return this.#request<{
      task: AgentTask;
      wasRunning: boolean;
      image: string;
    }>("POST", `/servers/${serverId}/recreate`, rest);
  }

  // --- Backups ---------------------------------------------------------

  listBackups(serverId: string) {
    return this.#request<{
      backups: { label: string; createdAt: string; usedBytes: number }[];
      hardQuota: boolean;
      kind: "zfs" | "directory";
    }>("GET", `/servers/${serverId}/backups`);
  }

  createBackup(serverId: string, rconPassword: string, keep: number) {
    return this.#request<{ task: AgentTask; label: string }>(
      "POST",
      `/servers/${serverId}/backup`,
      { rconPassword, keep },
    );
  }

  restoreBackup(serverId: string, rconPassword: string, label: string) {
    return this.#request<{ task: AgentTask; wasRunning: boolean }>(
      "POST",
      `/servers/${serverId}/restore`,
      { rconPassword, label },
    );
  }

  deleteBackup(serverId: string, label: string) {
    return this.#request<{ label: string }>(
      "DELETE",
      `/servers/${serverId}/backups/${encodeURIComponent(label)}`,
    );
  }

  /**
   * Adresse des Backup-Archivs beim Agent.
   *
   * Gibt bewusst nur die URL zurück statt der Daten: Ein Weltarchiv
   * wandert als Strom durch das Panel zum Browser und darf nirgends
   * vollständig im Speicher liegen. Wer sie benutzt, braucht auch das
   * Token — beides bleibt serverseitig.
   */
  archiveUrl(serverId: string, label: string): string {
    return `${this.baseUrl}/servers/${serverId}/backups/${encodeURIComponent(label)}/archive`;
  }

  get authHeader(): string {
    return `Bearer ${this.token}`;
  }

  // --- Einstellungen ---------------------------------------------------

  getProperties(serverId: string) {
    return this.#request<{
      entries: { key: string; value: string }[];
      guided: {
        key: string;
        label: string;
        type: "text" | "boolean" | "number" | "select";
        options?: string[];
        hint?: string;
      }[];
      protectedKeys: string[];
    }>("GET", `/servers/${serverId}/properties`);
  }

  updateProperties(serverId: string, updates: Record<string, string>) {
    return this.#request<{
      changed: string[];
      rejected: string[];
      restartRequired: boolean;
    }>("PATCH", `/servers/${serverId}/properties`, { updates });
  }

  /**
   * Erreichbarkeit so, wie ein Spieler sie erlebt: über den Router und mit
   * dem Hostnamen im Handshake. Prüft Container, Route und Bereitschaft in
   * einem Schritt.
   */
  ping(serverId: string) {
    return this.#request<{
      reachable: boolean;
      hostname: string;
      reason?: string;
      motd?: string;
      version?: string;
      playersOnline?: number;
      playersMax?: number;
    }>("GET", `/servers/${serverId}/ping`);
  }
}
