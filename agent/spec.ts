import type Docker from "dockerode";

import { heapForContainer } from "../src/lib/capacity.ts";
import { DEFAULT_GAME, gameOrThrow, type Game } from "../src/lib/games.ts";
import { portMappings } from "../src/lib/ports.ts";
import { imageForVersion } from "./java.ts";
import { containerName } from "./naming.ts";

export type ServerType = "VANILLA" | "PAPER" | "PURPUR" | "FABRIC" | "FORGE";

export type ServerSpec = {
  serverId: string;
  /** Schlüssel aus dem Spielkatalog. Fehlt er, ist es Minecraft. */
  game?: string;
  /**
   * Zugeteilter Host-Port. Null bei Minecraft, das sich den Router-Port
   * mit allen anderen teilt.
   */
  port?: number | null;
  subdomain: string;
  serverType: ServerType;
  mcVersion: string;
  memoryMb: number;
  cpuCores: number;
  maxPlayers: number;
  rconPassword: string;
  /** Hostpfad, der als /data eingehängt wird. */
  dataPath: string;
  /** Vollständiger Hostname, unter dem mc-router den Server erreichbar macht. */
  hostname: string;
  motd?: string;
  image?: string;
  network?: string;
  /**
   * Nur für die Entwicklung: RCON zusätzlich auf 127.0.0.1 veröffentlichen.
   * Auf dem Linux-Host erreicht der Agent den Container über das Bridge-Netz;
   * unter Docker Desktop liegt dieses Netz in einer VM und ist vom Host aus
   * nicht erreichbar. In Produktion bleibt das aus — ein offener RCON-Port
   * ist eine Fernsteuerung des Servers.
   */
  publishRcon?: boolean;
};

export const DEFAULT_IMAGE = "itzg/minecraft-server:java21";
export const DEFAULT_NETWORK = "mc-net";

/** Die UID, unter der das itzg-Image läuft. Das Datenverzeichnis muss ihr gehören. */
export const CONTAINER_UID = 1000;
export const CONTAINER_GID = 1000;

/**
 * Baut die vollständige Container-Definition. Reine Funktion, damit die
 * Härtungsregeln testbar sind statt nur im Docker-Aufruf zu stehen.
 */
export function buildContainerOptions(
  spec: ServerSpec,
): Docker.ContainerCreateOptions {
  const game = gameOrThrow(spec.game ?? DEFAULT_GAME);
  const istMinecraft = game.id === DEFAULT_GAME;

  const heapMb = istMinecraft ? heapForContainer(spec.memoryMb) : 0;
  const memoryBytes = spec.memoryMb * 1024 * 1024;

  // Bei Minecraft hängt das Image an der Spielversion, weil die Java-
  // Version dazu passen muss. Jedes andere Spiel bringt sein eigenes mit.
  const image =
    spec.image ??
    (istMinecraft ? imageForVersion(spec.mcVersion) : game.image);

  // Nur Spiele ohne Hostname-Routing veröffentlichen Ports nach außen.
  // Bei Minecraft bleibt der Container unerreichbar, Spieler kommen
  // ausschließlich über mc-router herein.
  const veröffentlicht =
    game.routing === "port" && spec.port ? portMappings(game, spec.port) : [];

  const cmd = gameCmd(spec, game);

  const exposed: Record<string, Record<string, never>> = {};
  const bindings: Record<string, { HostPort: string }[]> = {};

  for (const mapping of veröffentlicht) {
    const schlüssel = `${mapping.containerPort}/${mapping.transport}`;
    exposed[schlüssel] = {};
    bindings[schlüssel] = [{ HostPort: String(mapping.hostPort) }];
  }

  return {
    name: containerName(spec.serverId),
    Image: image,

    Labels: {
      "saas.managed": "true",
      "saas.serverId": spec.serverId,
      "saas.game": game.id,
      // mc-router kann Routen auch per Label entdecken; wir setzen sie
      // zusätzlich über die REST-API, damit ein Router-Neustart ohne
      // Docker-Socket auskommt. Nur Minecraft wird so geroutet.
      ...(istMinecraft ? { "mc-router.host": spec.hostname } : {}),
    },

    Env: istMinecraft ? buildEnv(spec, heapMb) : buildGameEnv(spec, game),

    // Nur setzen, wo das Image welche braucht. Minecraft bekommt keinen
    // Cmd, damit sein Bauplan der alte bleibt.
    ...(cmd ? { Cmd: cmd } : {}),

    // Gehört auf die Container-Ebene, nicht in HostConfig: Die Welt muss
    // beim Stoppen gespeichert werden dürfen.
    StopTimeout: 120,

    // Nur setzen, wenn wirklich etwas veröffentlicht wird. Ein leeres
    // Objekt wäre gleichbedeutend, aber der Container-Bauplan soll für
    // Minecraft Zeichen für Zeichen der alte bleiben.
    ...(Object.keys(exposed).length > 0 || spec.publishRcon
      ? {
          ExposedPorts: {
            ...exposed,
            // RCON kann in der Entwicklung auf einen zufälligen
            // localhost-Port gelegt werden; in Produktion bleibt es im
            // Bridge-Netz. Ein offener RCON-Port ist eine Fernsteuerung.
            ...(spec.publishRcon ? { "25575/tcp": {} } : {}),
          },
        }
      : {}),

    HostConfig: {
      NetworkMode: spec.network ?? DEFAULT_NETWORK,
      // Jedes Image legt seine Daten woanders ab; /data ist der Pfad des
      // itzg-Images. Stand hier für alle Spiele derselbe Pfad, schrieb
      // etwa Terraria seine Welt in die Container-Schicht: beim nächsten
      // Ersetzen des Containers weg, und die Sicherungen leer, weil die
      // das Dataset schnappschussen.
      Binds: [`${spec.dataPath}:${game.dataDir}`],

      ...(Object.keys(bindings).length > 0 || spec.publishRcon
        ? {
            PortBindings: {
              ...bindings,
              ...(spec.publishRcon
                ? { "25575/tcp": [{ HostIp: "127.0.0.1", HostPort: "0" }] }
                : {}),
            },
          }
        : {}),

      Memory: memoryBytes,
      // Gleich der Speichergrenze heißt: kein Swap. Eine swappende JVM
      // legt den ganzen Host lahm, ein sauberer OOM trifft nur diesen Server.
      MemorySwap: memoryBytes,
      NanoCpus: Math.round(spec.cpuCores * 1e9),

      // Gegen Fork-Bomben aus Mods.
      PidsLimit: 512,

      SecurityOpt: ["no-new-privileges:true"],

      // Alles fallen lassen und nur zurückgeben, was der Start wirklich
      // braucht: Das Image läuft zunächst als root, setzt die Eigentümer
      // von /data und wechselt dann auf den Nutzer minecraft (UID 1000).
      // Ohne SETUID/SETGID scheitert genau dieser Wechsel mit
      // "failed switching to 'minecraft:minecraft': operation not permitted",
      // und der Container läuft in eine Neustartschleife.
      //
      // Weggefallen sind damit unter anderem NET_RAW (Paket-Spoofing),
      // MKNOD, SYS_CHROOT, SETFCAP, SETPCAP und AUDIT_WRITE.
      CapDrop: ["ALL"],
      CapAdd: ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"],

      RestartPolicy: { Name: "unless-stopped" },

      LogConfig: {
        Type: "json-file",
        Config: { "max-size": "20m", "max-file": "3" },
      },

      Ulimits: [{ Name: "nofile", Soft: 8192, Hard: 8192 }],
    },
  };
}

function buildEnv(spec: ServerSpec, heapMb: number): string[] {
  const env: Record<string, string> = {
    EULA: "TRUE",
    TYPE: spec.serverType,
    VERSION: spec.mcVersion,

    // Bewusst nicht MEMORY: das setzt Xms und Xmx gleich dem Limit.
    INIT_MEMORY: `${Math.min(1024, heapMb)}M`,
    MAX_MEMORY: `${heapMb}M`,
    USE_AIKAR_FLAGS: "true",

    ENABLE_RCON: "true",
    RCON_PASSWORD: spec.rconPassword,
    RCON_PORT: "25575",
    // Der Broadcast würde das RCON-Passwort in die Server-Logs schreiben.
    BROADCAST_RCON_TO_OPS: "false",

    MAX_PLAYERS: String(spec.maxPlayers),
    MOTD: spec.motd ?? `${spec.subdomain} — powered by neuhauser.app`,
    OVERRIDE_SERVER_PROPERTIES: "true",

    // Ohne das würde ein Neustart nach Absturz die Welt neu erzeugen.
    SERVER_PORT: "25565",

    UID: String(CONTAINER_UID),
    GID: String(CONTAINER_GID),

    // Gibt Spielern beim Herunterfahren eine Vorwarnung.
    STOP_SERVER_ANNOUNCE_DELAY: "10",
  };

  return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}

/**
 * Umgebung für alle Spiele außer Minecraft.
 *
 * Bewusst schmal gehalten. Die Images unterscheiden sich stark in dem,
 * was sie erwarten — was hier steht, ist der kleinste gemeinsame Nenner
 * aus Servername, Spieleranzahl und Fernsteuerung. Alles Weitere
 * konfiguriert der Betreiber über den Dateimanager, so wie er es auch
 * bei einem selbst aufgesetzten Server täte.
 *
 * Die Namen der Variablen sind je Image verschieden; deshalb werden
 * gängige Schreibweisen nebeneinander gesetzt. Was ein Image nicht
 * kennt, ignoriert es.
 */
function buildGameEnv(spec: ServerSpec, game: Game): string[] {
  const env: Record<string, string> = {
    // Steam-Images lehnen ohne Zustimmung den Start ab.
    STEAMAPPVALIDATE: "1",

    SERVER_NAME: spec.subdomain,
    SERVERNAME: spec.subdomain,
    NAME: spec.subdomain,

    MAX_PLAYERS: String(spec.maxPlayers),
    MAXPLAYERS: String(spec.maxPlayers),

    PORT: String(game.gamePort),
    GAME_PORT: String(game.gamePort),

    TZ: "Europe/Vienna",

    // Dieselbe UID wie bei Minecraft, damit das Datenverzeichnis für
    // alle Spiele gleich behandelt werden kann.
    PUID: String(CONTAINER_UID),
    PGID: String(CONTAINER_GID),
    UID: String(CONTAINER_UID),
    GID: String(CONTAINER_GID),
  };

  if (game.rcon) {
    env.RCON_PASSWORD = spec.rconPassword;
    env.RCON_PORT = "27020";
    env.ENABLE_RCON = "true";
  }

  Object.assign(env, imageEnv(game));

  return Object.entries(env).map(([key, value]) => `${key}=${value}`);
}

/** Der Dateiname, unter dem Terraria die Welt ablegt. */
export const TERRARIA_WORLD = "welt.wld";

/**
 * Was nur ein bestimmtes Image versteht.
 *
 * Ohne WORLD_FILENAME startet ryshe/terraria den Server ohne `-world`,
 * und TShock fragt dann auf der Konsole, welche Welt es sein soll:
 *
 *   n           New World
 *   d <number>  Delete World
 *
 * Der Container läuft dabei, lauscht aber auf nichts. Gemessen an
 * bootstrap.sh im Image.
 */
function imageEnv(game: Game): Record<string, string> {
  if (game.id === "terraria") {
    return { WORLD_FILENAME: TERRARIA_WORLD };
  }

  return {};
}

/**
 * Startargumente, die das Image nicht selbst setzt.
 *
 * Terraria legt die Welt nur an, wenn `-autocreate` dabeisteht — sonst
 * bricht bootstrap.sh mit "Unable to locate ... and -autocreate flag is
 * not set" ab. Nachgemessen: Beim zweiten Start lädt es die vorhandene
 * Welt und legt keine neue an, das Argument darf also stehen bleiben.
 */
function gameCmd(spec: ServerSpec, game: Game): string[] | undefined {
  if (game.id === "terraria") {
    return [
      // 1 klein, 2 mittel, 3 groß. Mittel ist die übliche Wahl und
      // erzeugt rund 7 MB Welt.
      "-autocreate",
      "2",
      "-worldname",
      spec.subdomain,
      "-maxplayers",
      String(spec.maxPlayers),
      "-port",
      String(game.gamePort),
    ];
  }

  return undefined;
}

/**
 * Marker im Log, an dem der Server wirklich bereit ist. Der Container läuft
 * lange vorher — wer auf "running" wartet statt auf diese Zeile, meldet
 * "online", während Spieler noch Connection Refused bekommen.
 */
export const READY_PATTERN = /\)! For help, type "help"/;

/** Erkennt das Startversagen, damit der Aufrufer nicht ins Timeout läuft. */
export const FAILURE_PATTERNS: RegExp[] = [
  /You need to agree to the EULA/i,
  /FAILED TO BIND TO PORT/i,
  /java\.lang\.OutOfMemoryError/,
  /Exception in thread "main"/,
];
