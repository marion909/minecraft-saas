import { execFileSync } from "node:child_process";

import { DEFAULT_NETWORK } from "./spec.ts";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} fehlt. Siehe /etc/mc-agent/env bzw. .env.`);
  }
  return value;
}

/** Ist auf diesem Rechner ein nutzbarer ZFS-Pool da? */
export function detectZfs(pool: string): boolean {
  try {
    execFileSync("zfs", ["list", pool], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export type AgentConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  try {
    process.loadEnvFile();
  } catch {
    // Keine .env — auf dem Host kommen die Werte aus der systemd-Unit.
  }

  const pool = process.env.AGENT_ZFS_POOL ?? "tank/mc";
  const forced = process.env.AGENT_STORAGE;

  const useZfs =
    forced === "zfs" || (forced === undefined && detectZfs(pool));

  if (forced === "zfs" && !detectZfs(pool)) {
    throw new Error(
      `AGENT_STORAGE=zfs verlangt, aber der Pool "${pool}" ist nicht da.`,
    );
  }

  return {
    // Nur lokal lauschen. Der Agent hat den Docker-Socket und ist damit
    // root-gleichwertig — er gehört unter keinen Umständen ans offene Netz.
    host: process.env.AGENT_HOST ?? "127.0.0.1",
    port: Number(process.env.AGENT_PORT ?? 8787),
    token: required("AGENT_TOKEN"),

    docker: {
      socketPath: process.env.DOCKER_SOCKET ?? undefined,
      // Normalerweise leer: Das Image wird aus der Minecraft-Version
      // abgeleitet, damit die Java-Version passt. Setzen überschreibt das
      // für alle Server — nur für Sonderfälle gedacht.
      image: process.env.AGENT_IMAGE,
      network: process.env.AGENT_NETWORK ?? DEFAULT_NETWORK,
    },

    router: {
      // Der Router läuft als Container; seine API ist nur lokal veröffentlicht.
      url: process.env.AGENT_ROUTER_URL ?? "http://127.0.0.1:8080",
      // Der Spielport — hierüber wird geprüft, ob die Adresse eines Servers
      // wirklich funktioniert, und nicht nur, ob der Container läuft.
      host: process.env.AGENT_ROUTER_HOST ?? "127.0.0.1",
      port: Number(process.env.AGENT_ROUTER_PORT ?? 25565),
    },

    storage: {
      useZfs,
      pool,
      mountRoot: process.env.AGENT_DATA_ROOT ?? "/srv/mc",
      snapshotRoot: process.env.AGENT_BACKUP_ROOT ?? "/srv/backups",
    },

    /**
     * Nur für die Entwicklung: RCON zusätzlich auf 127.0.0.1 veröffentlichen.
     * Auf dem Linux-Host erreicht der Agent den Container direkt über das
     * Bridge-Netz; unter Docker Desktop auf macOS liegt dieses Netz in einer
     * VM und ist vom Host aus nicht erreichbar.
     */
    publishRcon: process.env.AGENT_PUBLISH_RCON === "true",

    // Obergrenze pro Upload. Modpacks sind groß, aber nicht beliebig —
    // ohne Grenze läuft die Platte über, bevor eine Quota greift.
    maxUploadBytes: Number(process.env.AGENT_MAX_UPLOAD_MB ?? 256) * 1024 * 1024,
  };
}
