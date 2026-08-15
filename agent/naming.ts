/**
 * Namen für Container, Datasets und Routen werden aus der Server-ID
 * abgeleitet — nie aus Nutzereingaben. Alles, was aus der Datenbank kommt,
 * wird hier trotzdem geprüft: Diese Werte landen in Docker-Aufrufen und in
 * Shell-Argumenten für ZFS, und dort ist ein durchgerutschtes Sonderzeichen
 * kein Schönheitsfehler.
 */

import { checkSubdomain } from "../src/lib/subdomain.ts";

const SERVER_ID = /^[a-z0-9]{20,32}$/;

export { RESERVED_SUBDOMAINS } from "../src/lib/subdomain.ts";

export function assertServerId(id: string): string {
  if (!SERVER_ID.test(id)) {
    throw new Error(`Ungültige Server-ID: "${id}".`);
  }
  return id;
}

export function assertSubdomain(subdomain: string): string {
  const result = checkSubdomain(subdomain);

  if (!result.ok) {
    throw new Error(`Ungültige Subdomain "${subdomain}": ${result.reason}`);
  }
  return result.value;
}

export function containerName(serverId: string): string {
  return `mc-${assertServerId(serverId)}`;
}

export function datasetName(pool: string, serverId: string): string {
  return `${pool}/srv-${assertServerId(serverId)}`;
}

export function dataPath(root: string, serverId: string): string {
  return `${root}/srv-${assertServerId(serverId)}`;
}

export function publicHostname(subdomain: string, publicHost: string): string {
  return `${assertSubdomain(subdomain)}.${publicHost}`;
}

/** Snapshot-Namen müssen sortierbar sein — ISO ohne Doppelpunkte. */
export function snapshotLabel(when: Date = new Date()): string {
  return when.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
}
