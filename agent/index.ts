import fsPromises from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { loadConfig, type AgentConfig } from "./config.ts";
import { DockerLayer } from "./docker.ts";
import * as files from "./files.ts";
import { collectHostInfo, powerHost } from "./host.ts";
import { DEFAULT_GAME, gameOrThrow } from "../src/lib/games.ts";
import {
  bearerToken,
  HttpError,
  readJsonBody,
  Router,
  sendJson,
  tokenMatches,
} from "./http.ts";
import { imageForVersion } from "./java.ts";
import { levelOf } from "./logstream.ts";
import { ping } from "./mcping.ts";
import { parsePlayerList } from "./players.ts";
import { PROTECTED_PROPERTIES } from "./paths.ts";
import {
  applyProperties,
  GUIDED_PROPERTIES,
  parseProperties,
} from "./properties.ts";
import {
  assertServerId,
  assertSubdomain,
  containerName,
  snapshotLabel,
} from "./naming.ts";
import { applyArchive, verifyArchive } from "./restore.ts";
import { backendFor, RouterClient } from "./router.ts";
import { SseStream } from "./sse.ts";
import { SampleFanout } from "./stats.ts";
import type { ServerSpec, ServerType } from "./spec.ts";
import { DirectoryStorage } from "./storage/directory.ts";
import type { Storage } from "./storage/types.ts";
import { ZfsStorage } from "./storage/zfs.ts";
import { TaskRegistry } from "./tasks.ts";

const SERVER_TYPES: ServerType[] = [
  "VANILLA",
  "PAPER",
  "PURPUR",
  "FABRIC",
  "FORGE",
];

function buildStorage(config: AgentConfig): Storage {
  if (config.storage.useZfs) {
    return new ZfsStorage(config.storage.pool, config.storage.mountRoot);
  }
  return new DirectoryStorage(
    config.storage.mountRoot,
    config.storage.snapshotRoot,
  );
}

function field(body: unknown, name: string): string {
  const value = (body as Record<string, unknown>)?.[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, `Feld "${name}" fehlt.`);
  }
  return value;
}

function numberField(body: unknown, name: string): number {
  const value = (body as Record<string, unknown>)?.[name];
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(400, `Feld "${name}" muss eine positive Zahl sein.`);
  }
  return parsed;
}

export function createAgent(config: AgentConfig) {
  const docker = new DockerLayer(config.docker);
  const storage = buildStorage(config);
  const tasks = new TaskRegistry();
  const mcRouter = new RouterClient(config.router.url);
  /** Ein Stats-Stream pro Container, egal wie viele Zuschauer. */
  const statsFanouts = new Map<string, SampleFanout>();
  const router = new Router();

  /**
   * Gleicht die Routentabelle des Routers mit der Wirklichkeit ab.
   *
   * Nötig, weil mc-router seine Routen nur im Speicher hält: Nach einem
   * Neustart des Routers wären sonst alle Server unerreichbar, obwohl die
   * Container laufen. Läuft beim Start des Agents und über /routes/reconcile.
   */
  async function reconcileRoutes(): Promise<{
    added: string[];
    removed: string[];
    total: number;
  }> {
    const [containers, existing] = await Promise.all([
      docker.listManaged(),
      mcRouter.list(),
    ]);

    const wanted = new Map<string, string>();
    for (const container of containers) {
      if (container.hostname && container.serverId) {
        wanted.set(container.hostname, backendFor(container.name));
      }
    }

    const added: string[] = [];
    const removed: string[] = [];

    for (const [hostname, backend] of wanted) {
      if (existing[hostname]?.backend !== backend) {
        await mcRouter.set(hostname, backend);
        added.push(hostname);
      }
    }

    // Routen zu Containern, die es nicht mehr gibt, zeigen ins Leere und
    // würden Spieler in einen Verbindungsfehler laufen lassen.
    for (const hostname of Object.keys(existing)) {
      if (!wanted.has(hostname)) {
        await mcRouter.remove(hostname);
        removed.push(hostname);
      }
    }

    return { added, removed, total: wanted.size };
  }

  /** Verhindert, dass zwei Vorgänge gleichzeitig denselben Server anfassen. */
  function assertIdle(serverId: string) {
    // Fährt der Host gerade herunter, ist jeder neue Vorgang sinnlos und
    // gefährlich: Ein Server, der jetzt noch startet, wird gleich mitten
    // im Weltladen von systemd abgeräumt.
    if (tasks.running().some((task) => task.kind === "host.power")) {
      throw new HttpError(
        409,
        "Der Host wird gerade geschaltet — bis dahin keine neuen Vorgänge.",
      );
    }

    const running = tasks.runningFor(serverId);
    if (running) {
      throw new HttpError(
        409,
        `Für diesen Server läuft bereits "${running.kind}".`,
      );
    }
  }

  router.get("/health", async () => {
    let dockerOk = true;
    let dockerError: string | null = null;

    try {
      await docker.ping();
    } catch (error) {
      dockerOk = false;
      dockerError = error instanceof Error ? error.message : String(error);
    }

    return {
      ok: dockerOk,
      docker: { ok: dockerOk, error: dockerError },
      storage: { kind: storage.kind, hardQuota: storage.hardQuota },
      network: config.docker.network,
      image: config.docker.image,
    };
  });

  router.get("/servers", async () => ({
    servers: await docker.listManaged(),
  }));

  router.get("/servers/:id", async ({ params }) => {
    const serverId = assertServerId(params.id ?? "");
    const state = await docker.inspect(serverId);

    const usage = (await storage.exists(serverId))
      ? await storage.usage(serverId)
      : null;

    return { serverId, ...state, usage, storage: storage.kind };
  });

  router.post("/servers", async ({ body }) => {
    const serverId = assertServerId(field(body, "serverId"));
    const subdomain = assertSubdomain(field(body, "subdomain"));
    const serverType = field(body, "serverType") as ServerType;

    if (!SERVER_TYPES.includes(serverType)) {
      throw new HttpError(400, `Unbekannter Servertyp "${serverType}".`);
    }

    assertIdle(serverId);

    const existing = await docker.inspect(serverId);
    if (existing.status !== "absent") {
      throw new HttpError(409, "Für diese ID gibt es bereits einen Container.");
    }

    // Fehlt die Angabe, ist es Minecraft — so sahen alle Anfragen aus,
    // bevor es mehrere Spiele gab.
    const gameId = (body as { game?: unknown })?.game;
    const game = gameOrThrow(typeof gameId === "string" && gameId ? gameId : DEFAULT_GAME);

    const portRaw = (body as { port?: unknown })?.port;
    const port =
      typeof portRaw === "number" && Number.isFinite(portRaw) ? portRaw : null;

    if (game.routing === "port" && port === null) {
      throw new HttpError(
        400,
        `${game.name} braucht einen eigenen Port — das Protokoll kennt ` +
          `keinen Hostnamen, über den sich Server unterscheiden ließen.`,
      );
    }

    const spec: ServerSpec = {
      serverId,
      game: game.id,
      port,
      subdomain,
      serverType,
      mcVersion: field(body, "mcVersion"),
      memoryMb: numberField(body, "memoryMb"),
      cpuCores: numberField(body, "cpuCores"),
      maxPlayers: numberField(body, "maxPlayers"),
      rconPassword: field(body, "rconPassword"),
      hostname: field(body, "hostname"),
      dataPath: storage.path(serverId),
      // Ein ausdrücklich gesetztes Image gilt nur für Minecraft; bei
      // anderen Spielen käme sonst der Minecraft-Container heraus.
      image: game.id === DEFAULT_GAME ? config.docker.image : undefined,
      network: config.docker.network,
      publishRcon: config.publishRcon,
    };

    const diskMb = numberField(body, "diskMb");
    const image =
      spec.image ??
      (game.id === DEFAULT_GAME ? imageForVersion(spec.mcVersion) : game.image);

    const task = tasks.start("server.provision", serverId, async (report) => {
      report("Netz prüfen");
      await docker.ensureNetwork(config.docker.network);

      report(`Speicher anlegen (${storage.kind})`);
      await storage.create(serverId, diskMb);

      report(`Image prüfen: ${image}`);
      await docker.pullImage(image, report);

      report("Container erstellen");
      await docker.create(spec);

      // Nur Minecraft läuft über den Router. Alles andere ist über
      // seinen eigenen Port erreichbar und braucht keinen Eintrag.
      if (game.routing === "hostname") {
        report(`Route eintragen: ${spec.hostname}`);
        await mcRouter.set(spec.hostname, backendFor(containerName(serverId)));
      } else {
        report(`Erreichbar über Port ${port}`);
      }

      report("fertig");
    });

    return { task };
  });

  router.post("/servers/:id/start", async ({ params, body }) => {
    const serverId = assertServerId(params.id ?? "");
    assertIdle(serverId);

    const state = await docker.inspect(serverId);
    if (state.status === "absent") {
      throw new HttpError(404, "Kein Container für diese ID.");
    }
    if (state.containerRunning) {
      return { alreadyRunning: true, state };
    }

    // Ohne Passwort gilt der Server schon nach dem Log-Marker als bereit.
    // Mit Passwort wird zusätzlich geprüft, dass er auf RCON antwortet —
    // erst das heißt wirklich "steuerbar".
    const rconPassword = (body as { rconPassword?: string })?.rconPassword;
    const wait = (body as { wait?: boolean })?.wait !== false;

    const task = tasks.start("server.start", serverId, async (report) => {
      report("Container starten");
      await docker.start(serverId);

      if (!wait) return;

      report("Warte auf Weltladen");
      const result = await docker.waitUntilReady(serverId, { rconPassword });

      if (!result.ready) {
        throw new Error(result.reason ?? "Server wurde nicht bereit.");
      }
      report("bereit");
    });

    return { task };
  });

  router.post("/servers/:id/stop", async ({ params, body }) => {
    const serverId = assertServerId(params.id ?? "");
    assertIdle(serverId);

    const rconPassword = field(body, "rconPassword");

    const task = tasks.start("server.stop", serverId, async (report) => {
      report("Welt sichern");
      const result = await docker.stop(serverId, rconPassword);

      report(
        result.saved
          ? "Welt gespeichert"
          : `WARNUNG: Speichern über RCON fehlgeschlagen — ${result.saveError ?? "unbekannt"}`,
      );
      report(`gestoppt über ${result.method}`);

      if (result.method === "kill") {
        // Bewusst kein Fehler: Der Server ist aus. Aber es gehört
        // protokolliert, weil ein Kill die Welt beschädigt haben kann.
        report(`WARNUNG: harter Kill nötig — ${result.error ?? ""}`);
      }
    });

    return { task };
  });

  router.post("/servers/:id/restart", async ({ params, body }) => {
    const serverId = assertServerId(params.id ?? "");
    assertIdle(serverId);

    const rconPassword = field(body, "rconPassword");

    const task = tasks.start("server.restart", serverId, async (report) => {
      report("Stoppen");
      await docker.stop(serverId, rconPassword);
      report("Starten");
      await docker.start(serverId);
      report("Warte auf Weltladen");
      const result = await docker.waitUntilReady(serverId);
      if (!result.ready) {
        throw new Error(result.reason ?? "Server wurde nicht bereit.");
      }
      report("bereit");
    });

    return { task };
  });

  /**
   * Erstellt den Container mit geänderter Version, Software oder
   * Ressourcengrenze neu. Die Weltdaten liegen als Bind-Mount außerhalb
   * des Containers und bleiben unangetastet.
   *
   * Ein Update der laufenden Container-Konfiguration gibt es bei Docker
   * nicht: Umgebungsvariablen und Speichergrenzen werden beim Anlegen
   * festgeschrieben. Deshalb der Umweg über Löschen und Neuanlegen.
   */
  router.post("/servers/:id/recreate", async ({ params, body }) => {
    const serverId = assertServerId(params.id ?? "");
    assertIdle(serverId);

    const before = await docker.inspect(serverId);
    if (before.status === "absent") {
      throw new HttpError(404, "Kein Container für diese ID.");
    }
    if (!before.hostname) {
      throw new HttpError(409, "Container ohne Hostname — bitte neu anlegen.");
    }

    const serverType = field(body, "serverType") as ServerType;
    if (!SERVER_TYPES.includes(serverType)) {
      throw new HttpError(400, `Unbekannter Servertyp "${serverType}".`);
    }

    const subdomain = assertSubdomain(field(body, "subdomain"));
    const rconPassword = field(body, "rconPassword");
    const wasRunning = before.containerRunning;

    const spec: ServerSpec = {
      serverId,
      subdomain,
      serverType,
      mcVersion: field(body, "mcVersion"),
      memoryMb: numberField(body, "memoryMb"),
      cpuCores: numberField(body, "cpuCores"),
      maxPlayers: numberField(body, "maxPlayers"),
      rconPassword,
      hostname: before.hostname,
      dataPath: storage.path(serverId),
      image: config.docker.image,
      network: config.docker.network,
      publishRcon: config.publishRcon,
    };

    const image = config.docker.image ?? imageForVersion(spec.mcVersion);
    const startAfter = (body as { start?: boolean })?.start !== false;

    const task = tasks.start("server.recreate", serverId, async (report) => {
      if (wasRunning) {
        report("Server stoppen");
        const stopped = await docker.stop(serverId, rconPassword);
        report(`gestoppt über ${stopped.method}`);
      }

      report(`Image prüfen: ${image}`);
      await docker.pullImage(image, report);

      // Erst hier entfernen: Wäre der Pull vorher gescheitert, stünde der
      // Nutzer ohne Container da — mit heilen Daten, aber ohne Server.
      report("Container ersetzen");
      await docker.remove(serverId);
      await docker.create(spec);

      report("Route bestätigen");
      await mcRouter
        .set(spec.hostname, backendFor(containerName(serverId)))
        .catch((error: unknown) => report(`Route: ${String(error)}`));

      if (!startAfter) {
        report("Container bleibt gestoppt");
        return;
      }

      report("Server starten");
      await docker.start(serverId);
      const ready = await docker.waitUntilReady(serverId, { rconPassword });

      if (!ready.ready) {
        throw new Error(
          `${ready.reason ?? "Server kam nicht hoch."} Die Weltdaten sind unverändert — ` +
            `mit der vorherigen Version lässt sich der Server wieder starten.`,
        );
      }
      report("bereit");
    });

    return { task, wasRunning, image };
  });

  router.delete("/servers/:id", async ({ params, body }) => {
    const serverId = assertServerId(params.id ?? "");
    assertIdle(serverId);

    const keepData = (body as { keepData?: boolean })?.keepData === true;
    const rconPassword = (body as { rconPassword?: string })?.rconPassword;

    const task = tasks.start("server.delete", serverId, async (report) => {
      // Zuerst die Route, dann der Container: Andersherum liefe ein
      // Spieler für einen Moment gegen einen Backend-Namen, den es
      // nicht mehr gibt.
      const state = await docker.inspect(serverId);
      const hostname = state.hostname;

      if (hostname) {
        report(`Route entfernen: ${hostname}`);
        await mcRouter.remove(hostname).catch((error: unknown) => {
          report(`Route ließ sich nicht entfernen: ${String(error)}`);
        });
      }

      if (rconPassword) {
        report("Sauber stoppen");
        await docker.stop(serverId, rconPassword).catch(() => {});
      }

      report("Container entfernen");
      await docker.remove(serverId);

      if (keepData) {
        report("Daten bleiben erhalten");
        return;
      }

      report("Speicher entfernen");
      if (await storage.exists(serverId)) {
        await storage.destroy(serverId);
      }
      report("fertig");
    });

    return { task };
  });

  router.post("/servers/:id/command", async ({ params, body }) => {
    const serverId = assertServerId(params.id ?? "");
    const rconPassword = field(body, "rconPassword");
    const command = field(body, "command");

    const output = await docker.command(serverId, rconPassword, command);
    return { output };
  });

  router.post("/servers/:id/backup", async ({ params, body }) => {
    const serverId = assertServerId(params.id ?? "");
    assertIdle(serverId);

    const rconPassword = field(body, "rconPassword");
    const label = snapshotLabel();

    // Wie viele Backups behalten werden. 0 heißt: keine Rotation.
    const keepRaw = (body as { keep?: unknown })?.keep;
    const keep = Number.isFinite(Number(keepRaw)) ? Number(keepRaw) : 0;

    const task = tasks.start("backup.create", serverId, async (report) => {
      const state = await docker.inspect(serverId);
      const live = state.containerRunning && state.ready;

      if (live) {
        report("Schreiben anhalten");
        await docker.command(serverId, rconPassword, "save-off");
        await docker.command(serverId, rconPassword, "save-all flush");
      }

      try {
        report(`Snapshot ${label}`);
        await storage.snapshot(serverId, label);
      } finally {
        // Zwingend im finally: Bleibt der Server im save-off-Zustand,
        // verliert er beim nächsten Absturz alles seit dem Backup.
        if (live) {
          report("Schreiben wieder freigeben");
          await docker
            .command(serverId, rconPassword, "save-on")
            .catch((error: unknown) => {
              report(`FEHLER bei save-on: ${String(error)}`);
            });
        }
      }

      // Rotation erst nach dem erfolgreichen Snapshot: Andernfalls stünde
      // man nach einem gescheiterten Backup mit einem gelöschten alten da.
      if (keep > 0) {
        const snapshots = await storage.listSnapshots(serverId);
        const surplus = snapshots.length - keep;

        for (const snapshot of snapshots.slice(0, Math.max(0, surplus))) {
          report(`ältestes Backup entfernen: ${snapshot.label}`);
          await storage.destroySnapshot(serverId, snapshot.label);
        }
      }

      report("fertig");
    });

    return { task, label };
  });

  router.get("/servers/:id/backups", async ({ params }) => {
    const serverId = assertServerId(params.id ?? "");
    return {
      backups: await storage.listSnapshots(serverId),
      hardQuota: storage.hardQuota,
      kind: storage.kind,
    };
  });

  /**
   * Spielt einen Snapshot zurück. Der Server muss dafür stehen — ein
   * Rollback unter einem laufenden Server würde ihm die Weltdateien unter
   * den Füßen wegziehen. Lief er vorher, wird er danach wieder gestartet.
   */
  router.post("/servers/:id/restore", async ({ params, body }) => {
    const serverId = assertServerId(params.id ?? "");
    assertIdle(serverId);

    const label = field(body, "label");
    const rconPassword = field(body, "rconPassword");

    const snapshots = await storage.listSnapshots(serverId);
    if (!snapshots.some((snapshot) => snapshot.label === label)) {
      throw new HttpError(404, `Kein Backup mit der Kennung "${label}".`);
    }

    const before = await docker.inspect(serverId);
    const wasRunning = before.containerRunning;

    const task = tasks.start("backup.restore", serverId, async (report) => {
      if (wasRunning) {
        report("Server stoppen");
        const stopped = await docker.stop(serverId, rconPassword);
        report(`gestoppt über ${stopped.method}`);
      }

      report(`Zurückspielen: ${label}`);
      await storage.rollback(serverId, label);

      if (wasRunning) {
        report("Server wieder starten");
        await docker.start(serverId);
        const ready = await docker.waitUntilReady(serverId, { rconPassword });
        if (!ready.ready) {
          throw new Error(
            ready.reason ?? "Server kam nach dem Zurückspielen nicht hoch.",
          );
        }
        report("bereit");
      } else {
        report("Server bleibt gestoppt");
      }
    });

    return { task, wasRunning };
  });

  /**
   * Ein Backup herunterladen — immer als tar.gz.
   *
   * Antwortet selbst und streamt, statt eine Datei zwischenzulegen: Ein
   * Weltarchiv kann Gigabytes haben, und der Platz dafür wäre genau der,
   * der auf einem vollen Node ohnehin knapp ist.
   */
  router.get("/servers/:id/backups/:label/archive", async ({ params, response }) => {
    const serverId = assertServerId(params.id ?? "");
    const label = params.label ?? "";

    if (!/^[A-Za-z0-9._-]+$/.test(label)) {
      throw new HttpError(400, "Ungültige Backup-Kennung.");
    }

    const vorhanden = await storage.listSnapshots(serverId);
    if (!vorhanden.some((snapshot) => snapshot.label === label)) {
      throw new HttpError(404, `Kein Backup mit der Kennung "${label}".`);
    }

    const archiv = await storage.readSnapshot(serverId, label);

    response.writeHead(200, {
      "content-type": "application/gzip",
      ...(archiv.sizeBytes === null
        ? {}
        : { "content-length": String(archiv.sizeBytes) }),
    });

    archiv.stream.pipe(response);

    // Bricht der Browser ab, endet auch das Packen — sonst liefe tar auf
    // dem Host weiter und schriebe in eine Leitung, die niemand liest.
    response.on("close", () => {
      if (!response.writableEnded) archiv.stream.destroy();
    });

    archiv.stream.on("error", (error: Error) => {
      console.error(`[agent] Backup-Download ${serverId}/${label}:`, error);
      response.destroy();
    });
  });

  /**
   * Ein Archiv einspielen. Ersetzt die Welt vollständig.
   *
   * Nimmt die Rohdaten entgegen, legt sie neben den Backups ab und prüft
   * sie, bevor irgendetwas gelöscht wird — siehe restore.ts. Der Server
   * wird dafür angehalten und danach wieder gestartet, wenn er lief.
   */
  router.post("/servers/:id/backups/import", async ({ params, request, response }) => {
    const serverId = assertServerId(params.id ?? "");
    assertIdle(serverId);

    if (!(await storage.exists(serverId))) {
      throw new HttpError(404, "Für diesen Server gibt es keinen Speicher.");
    }

    const url = new URL(request.url ?? "/", "http://agent.local");
    const rconPassword = url.searchParams.get("rconPassword") ?? undefined;

    const ablage = path.join(config.storage.snapshotRoot, "imports");
    await fsPromises.mkdir(ablage, { recursive: true });

    const ziel = path.join(ablage, `${serverId}-${Date.now()}.tar.gz`);
    const grenze = config.maxImportBytes;

    let geschrieben = 0;
    const handle = await fsPromises.open(ziel, "w");

    try {
      for await (const chunk of request) {
        geschrieben += (chunk as Buffer).length;

        if (geschrieben > grenze) {
          await handle.close();
          await fsPromises.rm(ziel, { force: true });
          throw new HttpError(
            413,
            `Archiv überschreitet das Limit von ${Math.round(grenze / 1024 / 1024)} MB.`,
          );
        }

        await handle.write(chunk as Buffer);
      }
      await handle.close();
    } catch (error) {
      await handle.close().catch(() => {});
      await fsPromises.rm(ziel, { force: true }).catch(() => {});
      throw error;
    }

    if (geschrieben === 0) {
      await fsPromises.rm(ziel, { force: true });
      throw new HttpError(400, "Es kamen keine Daten an.");
    }

    const usage = await storage.usage(serverId).catch(() => null);
    const limits = {
      // Die Quota des Servers ist die harte Schranke. Kennt der Treiber
      // keine, bleibt die allgemeine Obergrenze.
      maxTotalBytes: usage?.quotaBytes ?? grenze,
      maxEntries: 500_000,
    };

    const vorher = await docker.inspect(serverId);
    const liefVorher = vorher.containerRunning;

    const task = tasks.start("backup.import", serverId, async (report) => {
      try {
        // Zuerst das Archiv beurteilen, solange der Server noch läuft.
        // Ein kaputtes oder bösartiges Archiv soll niemanden aus dem
        // Spiel werfen — es wird abgelehnt, bevor irgendetwas angefasst
        // wird.
        report("Archiv prüfen");
        const geprüft = await verifyArchive(ziel, limits);
        report(
          `${geprüft.entries} Einträge, ${Math.round(geprüft.totalBytes / 1024 / 1024)} MB entpackt`,
        );

        if (liefVorher) {
          if (!rconPassword) {
            throw new Error(
              "Der Server läuft, aber es kam kein RCON-Passwort mit — " +
                "ohne das lässt sich die Welt nicht sauber sichern.",
            );
          }
          report("Server stoppen");
          const gestoppt = await docker.stop(serverId, rconPassword);
          report(`gestoppt über ${gestoppt.method}`);
        }

        // Erst jetzt, mit stehendem Server, ist der Sicherheitsschnappschuss
        // konsistent. Er ist der einzige Weg zurück, wenn das eingespielte
        // Archiv sich als das falsche herausstellt.
        const rettung = `vor-import-${snapshotLabel()}`;
        report(`Sicherung anlegen: ${rettung}`);
        await storage.snapshot(serverId, rettung);

        await applyArchive(storage.path(serverId), ziel, report);

        // Die entpackten Dateien gehören dem Agent; der Server läuft als
        // anderer Benutzer und könnte seine Welt sonst nicht speichern.
        // Wie das gerichtet wird, weiß nur der Speichertreiber.
        report("Für den Container freigeben");
        await storage.claim(serverId);

        report(`${geprüft.entries} Einträge eingespielt`);

        if (liefVorher) {
          report("Server wieder starten");
          await docker.start(serverId);
          const bereit = await docker.waitUntilReady(serverId, { rconPassword });

          if (!bereit.ready) {
            throw new Error(
              `${bereit.reason ?? "Server kam nicht hoch."} Das eingespielte ` +
                `Archiv liegt auf der Platte; mit dem Backup "${rettung}" ` +
                `lässt sich der vorherige Stand zurückholen.`,
            );
          }
          report("bereit");
        } else {
          report("Server bleibt gestoppt");
        }
      } finally {
        // Das Hochgeladene wird nicht aufbewahrt: Es liegt jetzt entpackt
        // im Serververzeichnis und zählt sonst doppelt gegen die Platte.
        await fsPromises.rm(ziel, { force: true }).catch(() => {});
      }
    });

    sendJson(response, 200, { task, receivedBytes: geschrieben });
  });

  router.delete("/servers/:id/backups/:label", async ({ params }) => {
    const serverId = assertServerId(params.id ?? "");
    const label = params.label ?? "";

    if (!/^[A-Za-z0-9._-]+$/.test(label)) {
      throw new HttpError(400, "Ungültige Backup-Kennung.");
    }

    await storage.destroySnapshot(serverId, label);
    return { label };
  });

  /**
   * Erreichbarkeitsprüfung so, wie ein Spieler sie erlebt: über den Router
   * und mit dem Hostnamen im Handshake. Das prüft Container, Route und
   * Serverbereitschaft in einem Schritt — ein laufender Container mit
   * fehlender Route fällt hier auf, sonst nirgends.
   */
  router.get("/servers/:id/ping", async ({ params }) => {
    const serverId = assertServerId(params.id ?? "");
    const state = await docker.inspect(serverId);

    if (!state.hostname) {
      throw new HttpError(404, "Für diesen Server gibt es keinen Hostnamen.");
    }
    if (!state.containerRunning) {
      return { reachable: false, reason: "Server läuft nicht.", hostname: state.hostname };
    }

    try {
      const result = await ping({
        host: config.router.host,
        port: config.router.port,
        serverAddress: state.hostname,
        timeoutMs: 5000,
      });

      return {
        reachable: true,
        hostname: state.hostname,
        motd: result.motd,
        version: result.versionName,
        playersOnline: result.playersOnline,
        playersMax: result.playersMax,
      };
    } catch (error) {
      return {
        reachable: false,
        hostname: state.hostname,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  });

  /** Fortlaufendes Log als Server-Sent Events. */
  router.get("/servers/:id/logs", async ({ params, request, response }) => {
    const serverId = assertServerId(params.id ?? "");
    const state = await docker.inspect(serverId);

    if (state.status === "absent") {
      throw new HttpError(404, "Kein Container für diese ID.");
    }

    const url = new URL(request.url ?? "/", "http://agent.local");
    const tail = Math.min(
      Math.max(Number(url.searchParams.get("tail") ?? 200), 0),
      2000,
    );

    const sse = new SseStream(response);
    const stop = await docker.followLogs(serverId, { tail }, (line) => {
      sse.send("line", { text: line, level: levelOf(line) });
    });

    // Ohne dieses Aufräumen bliebe pro geschlossenem Tab ein offener
    // Logstream am Docker-Daemon hängen.
    response.on("close", stop);
  });

  /** CPU und Arbeitsspeicher, geteilt über einen Stream pro Container. */
  router.get("/servers/:id/stats", async ({ params, response }) => {
    const serverId = assertServerId(params.id ?? "");
    const state = await docker.inspect(serverId);

    if (!state.containerRunning) {
      throw new HttpError(409, "Server läuft nicht.");
    }

    let fanout = statsFanouts.get(serverId);

    if (!fanout) {
      fanout = new SampleFanout((emit) => {
        let stopper: (() => void) | null = null;
        let cancelled = false;

        void docker.followStats(serverId, emit).then((stop) => {
          if (cancelled) stop();
          else stopper = stop;
        });

        return () => {
          cancelled = true;
          stopper?.();
          statsFanouts.delete(serverId);
        };
      });
      statsFanouts.set(serverId, fanout);
    }

    const sse = new SseStream(response);
    const unsubscribe = fanout.subscribe((sample) => sse.send("sample", sample));

    response.on("close", unsubscribe);
  });

  /** Wer ist gerade online? Kommt über RCON, nicht aus dem Log. */
  router.get("/servers/:id/players", async ({ params, request }) => {
    const serverId = assertServerId(params.id ?? "");
    const url = new URL(request.url ?? "/", "http://agent.local");
    const rconPassword = url.searchParams.get("rconPassword");

    if (!rconPassword) {
      throw new HttpError(400, "rconPassword fehlt.");
    }

    const output = await docker.command(serverId, rconPassword, "list");
    return parsePlayerList(output);
  });

  // ---------------------------------------------------------------------
  // Dateimanager. Jeder Pfad läuft durch safeResolve — siehe paths.ts.
  // ---------------------------------------------------------------------

  function rootFor(serverId: string): string {
    return storage.path(assertServerId(serverId));
  }

  function queryPath(request: http.IncomingMessage): string {
    const url = new URL(request.url ?? "/", "http://agent.local");
    return url.searchParams.get("path") ?? "";
  }

  router.get("/servers/:id/files", async ({ params, request }) =>
    files.list(rootFor(params.id ?? ""), queryPath(request)),
  );

  router.get("/servers/:id/file", async ({ params, request }) =>
    files.read(rootFor(params.id ?? ""), queryPath(request)),
  );

  router.put("/servers/:id/file", async ({ params, body }) => {
    const content = (body as { content?: unknown })?.content;
    if (typeof content !== "string") {
      throw new HttpError(400, "Feld \"content\" fehlt.");
    }
    return files.write(rootFor(params.id ?? ""), field(body, "path"), content);
  });

  router.post("/servers/:id/files/mkdir", async ({ params, body }) => ({
    path: await files.mkdir(rootFor(params.id ?? ""), field(body, "path")),
  }));

  router.delete("/servers/:id/file", async ({ params, body }) => ({
    path: await files.remove(rootFor(params.id ?? ""), field(body, "path")),
  }));

  router.post("/servers/:id/upload", async ({ params, request, response }) => {
    const target = await files.uploadTarget(
      rootFor(params.id ?? ""),
      queryPath(request),
    );

    const limit = config.maxUploadBytes;
    let written = 0;

    const handle = await fsPromises.open(target, "w");

    try {
      for await (const chunk of request) {
        written += (chunk as Buffer).length;

        if (written > limit) {
          // Abbrechen und aufräumen: Eine halb geschriebene Jar-Datei
          // würde den Server beim nächsten Start zerlegen.
          await handle.close();
          await fsPromises.rm(target, { force: true });
          throw new HttpError(
            413,
            `Datei überschreitet das Limit von ${Math.round(limit / 1024 / 1024)} MB.`,
          );
        }

        await handle.write(chunk as Buffer);
      }
      await handle.close();
    } catch (error) {
      await handle.close().catch(() => {});
      throw error;
    }

    sendJson(response, 200, { path: queryPath(request), sizeBytes: written });
  });

  // ---------------------------------------------------------------------
  // server.properties
  // ---------------------------------------------------------------------

  router.get("/servers/:id/properties", async ({ params }) => {
    const content = await files.read(
      rootFor(params.id ?? ""),
      "server.properties",
    );

    if (content.kind !== "text") {
      throw new HttpError(409, "server.properties ist noch nicht lesbar.");
    }

    return {
      entries: parseProperties(content.content),
      guided: GUIDED_PROPERTIES,
      protectedKeys: [...PROTECTED_PROPERTIES],
    };
  });

  router.patch("/servers/:id/properties", async ({ params, body }) => {
    const updates = (body as { updates?: unknown })?.updates;

    if (!updates || typeof updates !== "object") {
      throw new HttpError(400, "Feld \"updates\" fehlt.");
    }

    const root = rootFor(params.id ?? "");
    const current = await files.read(root, "server.properties");

    if (current.kind !== "text") {
      throw new HttpError(409, "server.properties ist nicht lesbar.");
    }

    const result = applyProperties(
      current.content,
      updates as Record<string, string>,
    );

    await files.write(root, "server.properties", result.text);

    return {
      changed: result.changed,
      rejected: result.rejected,
      // Minecraft liest die Datei nur beim Start.
      restartRequired: result.changed.length > 0,
    };
  });

  // ---------------------------------------------------------------------
  // Der Host selbst
  // ---------------------------------------------------------------------

  router.get("/host", async () => {
    const [info, containers] = await Promise.all([
      collectHostInfo(config.storage.mountRoot),
      docker.listManaged().catch(() => []),
    ]);

    return {
      ...info,
      containers: {
        total: containers.length,
        running: containers.filter((entry) => entry.state === "running").length,
      },
      busy: tasks.running().map((task) => ({
        id: task.id,
        kind: task.kind,
        serverId: task.serverId,
      })),
    };
  });

  /**
   * Neustarten oder ausschalten — mit sauber angehaltenen Servern.
   *
   * Der Umweg über diesen Endpunkt statt eines blanken `reboot` ist der
   * ganze Zweck: Beim Herunterfahren gibt systemd dem Docker-Daemon
   * wenige Sekunden, und der reicht sie an die Container weiter. Ein
   * Minecraft-Server braucht zum Speichern seiner Welt deutlich länger.
   * Wer ohne dieses Anhalten neu startet, würfelt bei jedem Server, ob
   * die Welt beschädigt zurückkommt.
   *
   * Die RCON-Passwörter kommen mit der Anfrage, weil nur das Panel sie
   * kennt. Der Agent hält sie nirgends vor.
   */
  router.post("/host/power", async ({ body }) => {
    const mode = field(body, "mode");

    if (mode !== "reboot" && mode !== "poweroff") {
      throw new HttpError(400, `Unbekannter Modus "${mode}".`);
    }

    const busy = tasks.running();
    if (busy.length > 0) {
      throw new HttpError(
        409,
        `Es laufen noch ${busy.length} Vorgänge (${busy
          .map((task) => task.kind)
          .join(", ")}). Erst abwarten — ein Neustart mitten in einem ` +
          `Backup lässt den Server im save-off-Zustand zurück.`,
      );
    }

    const raw = (body as { servers?: unknown })?.servers;
    if (!Array.isArray(raw)) {
      throw new HttpError(400, 'Feld "servers" fehlt.');
    }

    const servers = raw.map((entry) => {
      const item = entry as { serverId?: unknown; rconPassword?: unknown };

      if (
        typeof item.serverId !== "string" ||
        typeof item.rconPassword !== "string" ||
        item.rconPassword.length === 0
      ) {
        throw new HttpError(400, "Jeder Eintrag braucht serverId und rconPassword.");
      }

      return {
        serverId: assertServerId(item.serverId),
        rconPassword: item.rconPassword,
      };
    });

    const task = tasks.start("host.power", null, async (report) => {
      let stopped = 0;

      for (const entry of servers) {
        const state = await docker.inspect(entry.serverId).catch(() => null);

        if (!state || !state.containerRunning) continue;

        report(`Server anhalten: ${entry.serverId}`);

        try {
          const result = await docker.stop(entry.serverId, entry.rconPassword);
          stopped += 1;
          report(
            result.saved
              ? `${entry.serverId}: Welt gespeichert, gestoppt über ${result.method}`
              : `${entry.serverId}: WARNUNG — Speichern fehlgeschlagen (${result.saveError ?? "unbekannt"})`,
          );
        } catch (error) {
          // Kein Abbruch: Ein Server, der sich nicht anhalten lässt,
          // wird durch das Weiterlaufen des Hosts nicht heiler. Aber es
          // gehört ins Protokoll, damit hinterher klar ist, welche Welt
          // hart beendet wurde.
          report(
            `${entry.serverId}: FEHLER beim Anhalten — ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      report(`${stopped} Server angehalten, ${servers.length} geprüft`);
      report(mode === "reboot" ? "Host startet neu" : "Host schaltet ab");

      // Etwas Luft, damit dieser Fortschritt noch abgeholt werden kann,
      // bevor systemd den Agent beendet.
      await new Promise((resolve) => setTimeout(resolve, 2000));

      await powerHost(mode);
    });

    return { task, servers: servers.length };
  });

  router.get("/routes", async () => {
    const [routes, containers] = await Promise.all([
      mcRouter.list().catch(() => null),
      docker.listManaged(),
    ]);

    return {
      reachable: routes !== null,
      routes: routes ?? {},
      expected: containers
        .filter((container) => container.hostname)
        .map((container) => ({
          hostname: container.hostname,
          backend: backendFor(container.name),
          state: container.state,
        })),
    };
  });

  router.post("/routes/reconcile", async () => reconcileRoutes());

  router.get("/tasks", async () => ({ tasks: tasks.list().slice(0, 50) }));

  router.get("/tasks/:id", async ({ params }) => {
    const task = tasks.get(params.id ?? "");
    if (!task) throw new HttpError(404, "Unbekannter Vorgang.");
    return task;
  });

  const server = http.createServer((request, response) => {
    void handle(request, response);
  });

  async function handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://agent.local");

    try {
      const token = bearerToken(request);

      if (!token || !tokenMatches(token, config.token)) {
        throw new HttpError(401, "Nicht autorisiert.");
      }

      const route = router.match(request.method ?? "GET", url.pathname);
      if (!route) throw new HttpError(404, "Unbekannter Endpunkt.");

      // Uploads schicken rohe Bytes; die darf der JSON-Leser nicht
      // verschlucken, sonst ist der Stream beim Handler schon leer.
      const contentType = request.headers["content-type"] ?? "";
      const body =
        request.method === "GET" || !contentType.includes("application/json")
          ? {}
          : await readJsonBody(request);

      const result = await route.handler({
        request,
        response,
        params: route.params,
        body,
      });

      // Streaming-Endpunkte haben schon selbst geantwortet; ein zusätzliches
      // JSON würde ihren Datenstrom verderben.
      if (!response.headersSent && !response.writableEnded) {
        sendJson(response, 200, result ?? { ok: true });
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message =
        error instanceof Error ? error.message : "Unbekannter Fehler.";

      if (status >= 500) {
        console.error(`[agent] ${request.method} ${url.pathname}:`, error);
      }

      if (!response.headersSent && !response.writableEnded) {
        sendJson(response, status, { error: message });
      } else {
        response.end();
      }
    }
  }

  return { server, docker, storage, tasks, config, mcRouter, reconcileRoutes };
}

/** Direkter Start: `node agent/index.ts` bzw. über die systemd-Unit. */
if (import.meta.filename === process.argv[1]) {
  const config = loadConfig();
  const agent = createAgent(config);

  if (!agent.storage.hardQuota) {
    console.warn(
      [
        "",
        "⚠  Speichertreiber ohne harte Quota (kein ZFS-Pool gefunden).",
        "   Server können ihre Speichergrenze überschreiten. Für die",
        "   Entwicklung in Ordnung, für Produktion nicht.",
        "",
      ].join("\n"),
    );
  }

  agent.server.listen(config.port, config.host, async () => {
    console.info(
      `[agent] lauscht auf http://${config.host}:${config.port} ` +
        `(Speicher: ${agent.storage.kind}, Netz: ${config.docker.network})`,
    );

    // Der Router hält Routen nur im Speicher. Ohne diesen Abgleich beim
    // Start wären nach einem Router-Neustart alle Server unerreichbar,
    // obwohl die Container laufen.
    try {
      const result = await agent.reconcileRoutes();
      console.info(
        `[agent] Routen abgeglichen: ${result.total} aktiv ` +
          `(${result.added.length} gesetzt, ${result.removed.length} entfernt)`,
      );
    } catch (error) {
      console.warn(
        `[agent] Routen konnten nicht abgeglichen werden: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });
}
