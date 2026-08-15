import type Docker from "dockerode";

import { heapForContainer } from "../src/lib/capacity.ts";
import { imageForVersion } from "./java.ts";
import { containerName } from "./naming.ts";

export type ServerType = "VANILLA" | "PAPER" | "PURPUR" | "FABRIC" | "FORGE";

export type ServerSpec = {
  serverId: string;
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
  const heapMb = heapForContainer(spec.memoryMb);
  const memoryBytes = spec.memoryMb * 1024 * 1024;

  return {
    name: containerName(spec.serverId),
    // Ohne passendes Java startet der Server nicht. Ein ausdrücklich
    // gesetztes Image gewinnt, sonst wird es aus der Version abgeleitet.
    Image: spec.image ?? imageForVersion(spec.mcVersion),

    Labels: {
      "saas.managed": "true",
      "saas.serverId": spec.serverId,
      // mc-router kann Routen auch per Label entdecken; wir setzen sie
      // zusätzlich über die REST-API, damit ein Router-Neustart ohne
      // Docker-Socket auskommt.
      "mc-router.host": spec.hostname,
    },

    Env: buildEnv(spec, heapMb),

    // Gehört auf die Container-Ebene, nicht in HostConfig: Die Welt muss
    // beim Stoppen gespeichert werden dürfen.
    StopTimeout: 120,

    // Der Spielport wird nie veröffentlicht — Spieler kommen ausschließlich
    // über mc-router herein. Nur RCON kann in der Entwicklung auf einen
    // zufälligen localhost-Port gelegt werden.
    ...(spec.publishRcon ? { ExposedPorts: { "25575/tcp": {} } } : {}),

    HostConfig: {
      NetworkMode: spec.network ?? DEFAULT_NETWORK,
      Binds: [`${spec.dataPath}:/data`],

      ...(spec.publishRcon
        ? {
            PortBindings: {
              "25575/tcp": [{ HostIp: "127.0.0.1", HostPort: "0" }],
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
