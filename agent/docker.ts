import Docker from "dockerode";

import { DockerLogDemuxer, LineAssembler } from "./logstream.ts";
import { containerName } from "./naming.ts";
import { withRcon } from "./rcon.ts";
import { computeSample, type DockerStats, type ResourceSample } from "./stats.ts";
import {
  buildContainerOptions,
  FAILURE_PATTERNS,
  READY_PATTERN,
  type ServerSpec,
} from "./spec.ts";

export type ServerStatus =
  | "absent"
  | "created"
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed";

export type ServerState = {
  status: ServerStatus;
  containerId: string | null;
  /** Läuft der Container? Sagt noch nichts darüber, ob die Welt geladen ist. */
  containerRunning: boolean;
  /** Antwortet der Minecraft-Server? Erst dann können Spieler verbinden. */
  ready: boolean;
  exitCode: number | null;
  startedAt: string | null;
  rcon: { host: string; port: number } | null;
  /** Aus dem Container-Label — die Adresse, unter der mc-router ihn führt. */
  hostname: string | null;
};

export class DockerLayer {
  readonly docker: Docker;

  constructor(options: { socketPath?: string } = {}) {
    this.docker = new Docker(
      options.socketPath ? { socketPath: options.socketPath } : {},
    );
  }

  async ping(): Promise<void> {
    await this.docker.ping();
  }

  /** Legt das Netz an, falls es fehlt. Idempotent. */
  async ensureNetwork(name: string): Promise<void> {
    const networks = await this.docker.listNetworks({
      filters: { name: [name] },
    });

    if (networks.some((network) => network.Name === name)) return;

    await this.docker.createNetwork({ Name: name, Driver: "bridge" });
  }

  async hasImage(image: string): Promise<boolean> {
    try {
      await this.docker.getImage(image).inspect();
      return true;
    } catch {
      return false;
    }
  }

  /** Zieht das Image, falls nötig. Läuft bei kaltem Cache mehrere Minuten. */
  async pullImage(image: string, onProgress?: (line: string) => void): Promise<void> {
    if (await this.hasImage(image)) return;

    const stream = await this.docker.pull(image);

    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (error) => (error ? reject(error) : resolve()),
        (event: { status?: string; progress?: string }) => {
          if (onProgress && event.status) {
            onProgress(
              event.progress ? `${event.status} ${event.progress}` : event.status,
            );
          }
        },
      );
    });
  }

  #container(serverId: string) {
    return this.docker.getContainer(containerName(serverId));
  }

  async inspect(serverId: string): Promise<ServerState> {
    let info: Docker.ContainerInspectInfo;

    try {
      info = await this.#container(serverId).inspect();
    } catch {
      return {
        status: "absent",
        containerId: null,
        containerRunning: false,
        ready: false,
        exitCode: null,
        startedAt: null,
        rcon: null,
        hostname: null,
      };
    }

    const running = info.State.Running === true;
    const ready = running ? await this.isReady(serverId) : false;

    let status: ServerStatus;
    if (running) {
      status = ready ? "running" : "starting";
    } else if (info.State.ExitCode && info.State.ExitCode !== 0) {
      status = "failed";
    } else if (info.State.Status === "created") {
      status = "created";
    } else {
      status = "stopped";
    }

    return {
      status,
      containerId: info.Id,
      containerRunning: running,
      ready,
      exitCode: info.State.ExitCode ?? null,
      startedAt: info.State.StartedAt ?? null,
      rcon: this.#rconTarget(info),
      hostname: info.Config?.Labels?.["mc-router.host"] ?? null,
    };
  }

  /**
   * Wohin der Agent RCON sprechen muss. Auf dem Linux-Host ist das die
   * Container-IP im Bridge-Netz; wurde der Port veröffentlicht (Entwicklung),
   * ist es der localhost-Port.
   */
  #rconTarget(info: Docker.ContainerInspectInfo): { host: string; port: number } | null {
    const published = info.NetworkSettings?.Ports?.["25575/tcp"]?.[0];

    if (published?.HostPort) {
      return { host: published.HostIp || "127.0.0.1", port: Number(published.HostPort) };
    }

    const networks = info.NetworkSettings?.Networks ?? {};
    for (const network of Object.values(networks)) {
      if (network?.IPAddress) {
        return { host: network.IPAddress, port: 25575 };
      }
    }

    return null;
  }

  async create(spec: ServerSpec): Promise<string> {
    const options = buildContainerOptions(spec);
    const container = await this.docker.createContainer(options);
    return container.id;
  }

  async start(serverId: string): Promise<void> {
    await this.#container(serverId).start();
  }

  /**
   * Wartet, bis der Server wirklich bereit ist — nicht bis der Container
   * läuft. Bricht ab, sobald ein bekanntes Fehlermuster im Log auftaucht,
   * damit ein EULA- oder Portfehler nicht ins Timeout läuft.
   */
  /**
   * Bestätigt nach dem Log-Marker, dass der Server auch wirklich auf RCON
   * antwortet. Der Marker allein reicht nicht: Unter Docker Desktop nimmt
   * die Portweiterleitung Verbindungen bereits an, während der Server
   * dahinter noch nicht bedient — der erste Befehl scheitert dann mit
   * "Verbindung geschlossen".
   */
  async #confirmControllable(
    serverId: string,
    rconPassword: string,
    attempts = 20,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        await this.command(serverId, rconPassword, "list");
        return true;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    return false;
  }

  async waitUntilReady(
    serverId: string,
    options: { timeoutMs?: number; rconPassword?: string } = {},
  ): Promise<{ ready: boolean; reason?: string }> {
    const timeoutMs = options.timeoutMs ?? 240_000;
    const logResult = await this.#waitForReadyLog(serverId, timeoutMs);

    if (!logResult.ready) return logResult;
    if (!options.rconPassword) return logResult;

    return (await this.#confirmControllable(serverId, options.rconPassword))
      ? { ready: true }
      : {
          ready: false,
          reason:
            "Server meldet sich als gestartet, antwortet aber nicht auf RCON.",
        };
  }

  async #waitForReadyLog(
    serverId: string,
    timeoutMs: number,
  ): Promise<{ ready: boolean; reason?: string }> {
    const container = this.#container(serverId);
    const deadline = Date.now() + timeoutMs;

    // Die Restart-Policy lässt einen abstürzenden Container sofort wieder
    // hochkommen. Ohne diesen Ausgangswert sähe eine Absturzschleife aus
    // wie ein Server, der nur langsam startet.
    const initialRestarts = await container
      .inspect()
      .then((info) => info.RestartCount ?? 0)
      .catch(() => 0);

    const stream = (await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 200,
    })) as NodeJS.ReadableStream;

    return new Promise((resolve) => {
      let settled = false;

      const finish = (result: { ready: boolean; reason?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(deathCheck);
        (stream as unknown as { destroy?: () => void }).destroy?.();
        resolve(result);
      };

      const timer = setTimeout(
        () =>
          finish({
            ready: false,
            reason: `Nach ${Math.round(timeoutMs / 1000)}s nicht bereit.`,
          }),
        timeoutMs,
      );

      // Stirbt der Container, kommen keine Logzeilen mehr — ohne diese
      // Prüfung würde hier bis zum Timeout gewartet.
      const deathCheck = setInterval(async () => {
        if (Date.now() > deadline) return;
        try {
          const info = await container.inspect();

          if ((info.RestartCount ?? 0) > initialRestarts) {
            finish({
              ready: false,
              reason:
                `Container startet immer wieder neu (${info.RestartCount} Versuche). ` +
                `Letzter Exit-Code ${info.State.ExitCode}. Siehe Container-Log.`,
            });
            return;
          }

          if (!info.State.Running) {
            finish({
              ready: false,
              reason: `Container beendet mit Code ${info.State.ExitCode}.`,
            });
          }
        } catch {
          finish({ ready: false, reason: "Container verschwunden." });
        }
      }, 3000);

      stream.on("data", (chunk: Buffer) => {
        // Ohne TTY multiplext Docker den Stream und stellt jedem Frame
        // einen 8-Byte-Header voran. Für die Mustersuche reicht es, den
        // Text roh zu betrachten.
        const text = chunk.toString("utf8");

        if (READY_PATTERN.test(text)) {
          finish({ ready: true });
          return;
        }

        for (const pattern of FAILURE_PATTERNS) {
          if (pattern.test(text)) {
            finish({ ready: false, reason: `Startfehler: ${pattern.source}` });
            return;
          }
        }
      });

      // Endet der Stream, ist der Container gestorben. Der Grund steht im
      // Container-Zustand, nicht im Stream — ohne diese Nachfrage bekäme
      // der Aufrufer nur "Logstream endete" und müsste selbst suchen.
      stream.on("end", () => {
        void container
          .inspect()
          .then((info) => {
            const restarts = info.RestartCount ?? 0;
            finish({
              ready: false,
              reason:
                restarts > initialRestarts
                  ? `Container startet immer wieder neu (${restarts} Versuche, letzter Exit-Code ${info.State.ExitCode}).`
                  : `Container beendet mit Code ${info.State.ExitCode}.`,
            });
          })
          .catch(() =>
            finish({ ready: false, reason: "Container verschwunden." }),
          );
      });
      stream.on("error", (error: Error) =>
        finish({ ready: false, reason: error.message }),
      );
    });
  }

  async isReady(serverId: string): Promise<boolean> {
    const state = await this.#container(serverId)
      .inspect()
      .catch(() => null);

    if (!state?.State.Running) return false;

    const target = this.#rconTarget(state);
    if (!target) return false;

    // Ein TCP-Connect auf den RCON-Port genügt als Bereitschaftsprüfung:
    // der Port wird erst gebunden, wenn der Server hochgefahren ist.
    return reachable(target.host, target.port, 1000);
  }

  /**
   * Dreistufiges Stoppen. Ein `kill` auf einen laufenden Minecraft-Server
   * kann Chunk-Dateien zerreißen, deshalb bekommt er zuerst die Gelegenheit,
   * selbst zu speichern.
   */
  async stop(
    serverId: string,
    rconPassword: string,
  ): Promise<{
    method: "graceful" | "kill";
    /** Wurde die Welt vor dem Herunterfahren nachweislich geschrieben? */
    saved: boolean;
    saveError?: string;
    error?: string;
  }> {
    const state = await this.inspect(serverId);

    if (!state.containerRunning) return { method: "graceful", saved: true };

    // 1. Welt sichern, solange der Server noch antwortet.
    //
    //    Bewusst NUR save-all und kein RCON-"stop": Bei "stop" beendet sich
    //    der Prozess von selbst, Docker wertet das als Absturz und die
    //    RestartPolicy "unless-stopped" startet den Container sofort wieder.
    //    Nachgemessen: RestartCount springt dabei von 0 auf 1, der Server
    //    ist Sekunden später wieder oben.
    let saved = false;
    let saveError: string | undefined;

    if (state.rcon) {
      try {
        await withRcon(
          { ...state.rcon, password: rconPassword, timeoutMs: 15_000 },
          async (client) => {
            await client.command("save-all flush");
          },
        );
        saved = true;
      } catch (error) {
        saveError = error instanceof Error ? error.message : String(error);
      }
    } else {
      saveError = "Kein RCON-Ziel ermittelbar.";
    }

    // 2. `docker stop` markiert den Container als absichtlich gestoppt —
    //    nur so hält sich die RestartPolicy heraus. SIGTERM reicht das
    //    itzg-Image korrekt an die JVM weiter, die noch einmal speichert.
    try {
      await this.#container(serverId).stop({ t: 120 });
      return { method: "graceful", saved, saveError };
    } catch (error) {
      // 3. Letztes Mittel. Der Aufrufer protokolliert das — ein Kill kann
      //    Chunk-Dateien zerreißen.
      await this.#container(serverId).kill().catch(() => {});
      return {
        method: "kill",
        saved,
        saveError,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async #waitForExit(serverId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const info = await this.#container(serverId)
        .inspect()
        .catch(() => null);

      if (!info || !info.State.Running) return true;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return false;
  }

  async remove(serverId: string): Promise<void> {
    await this.#container(serverId)
      .remove({ force: true, v: false })
      .catch((error: { statusCode?: number }) => {
        // 404 heißt: schon weg. Das ist das gewünschte Ergebnis.
        if (error?.statusCode !== 404) throw error;
      });
  }

  /**
   * Folgt dem Log eines Containers. Gibt eine Abbruchfunktion zurück —
   * ohne die bliebe pro geschlossenem Browser-Tab ein offener Stream am
   * Docker-Daemon hängen.
   */
  async followLogs(
    serverId: string,
    options: { tail?: number },
    onLine: (line: string) => void,
  ): Promise<() => void> {
    const stream = (await this.#container(serverId).logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: options.tail ?? 200,
      timestamps: false,
    })) as NodeJS.ReadableStream;

    const demuxer = new DockerLogDemuxer();
    const lines = new LineAssembler();

    stream.on("data", (chunk: Buffer) => {
      for (const frame of demuxer.push(chunk)) {
        for (const line of lines.push(frame.text)) onLine(line);
      }
    });

    return () => {
      (stream as unknown as { destroy?: () => void }).destroy?.();
    };
  }

  /**
   * Liefert fortlaufend Messwerte eines Containers. Wird über SampleFanout
   * geteilt, damit Docker nur einen Stream pro Container bedienen muss.
   */
  async followStats(
    serverId: string,
    onSample: (sample: ResourceSample) => void,
  ): Promise<() => void> {
    const stream = (await this.#container(serverId).stats({
      stream: true,
    })) as NodeJS.ReadableStream;

    let buffer = "";

    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");

      // Docker schickt je Messung ein JSON-Objekt pro Zeile.
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;

        try {
          onSample(computeSample(JSON.parse(line) as DockerStats));
        } catch {
          // Eine unlesbare Messung ist kein Grund, den Stream aufzugeben.
        }
      }
    });

    return () => {
      (stream as unknown as { destroy?: () => void }).destroy?.();
    };
  }

  async command(
    serverId: string,
    rconPassword: string,
    command: string,
  ): Promise<string> {
    const state = await this.inspect(serverId);

    if (!state.rcon) {
      throw new Error("Server ist nicht erreichbar.");
    }

    return withRcon(
      { ...state.rcon, password: rconPassword, timeoutMs: 10_000 },
      (client) => client.command(command),
    );
  }

  /**
   * Alle vom Panel verwalteten Container — Grundlage für den Abgleich.
   * Der Hostname kommt aus dem Label und nicht aus der Datenbank: So kann
   * der Agent die Routen auch dann wiederherstellen, wenn er die App
   * gerade nicht erreicht.
   */
  async listManaged(): Promise<
    { serverId: string; name: string; state: string; hostname: string | null }[]
  > {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: ["saas.managed=true"] },
    });

    return containers.map((container) => ({
      serverId: container.Labels["saas.serverId"] ?? "",
      name: container.Names[0]?.replace(/^\//, "") ?? "",
      state: container.State,
      hostname: container.Labels["mc-router.host"] ?? null,
    }));
  }
}

async function reachable(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  const net = await import("node:net");

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
