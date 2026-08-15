/**
 * Regeln für die Subdomain eines Servers. Liegt hier und nicht im Agent,
 * weil beide Seiten dieselbe Prüfung brauchen: Das Panel, um dem Nutzer
 * einen Fehler am Feld zu zeigen, der Agent, weil der Wert in Docker-Labels
 * und Routing-Einträge geht.
 */

export const SUBDOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]{1,30}$/;

/** Namen, die der Infrastruktur gehören und niemandem zugeteilt werden. */
export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "admin",
  "panel",
  "mail",
  "smtp",
  "imap",
  "ns",
  "ns1",
  "ns2",
  "status",
  "mc",
  "router",
  "agent",
  "node",
  "backup",
  "test",
  "staging",
  "support",
  "help",
  "shop",
]);

export type SubdomainCheck =
  | { ok: true; value: string }
  | { ok: false; reason: string };

export function checkSubdomain(input: string): SubdomainCheck {
  const value = input.trim().toLowerCase();

  if (value.length < 2) {
    return { ok: false, reason: "Mindestens 2 Zeichen." };
  }
  if (value.length > 31) {
    return { ok: false, reason: "Höchstens 31 Zeichen." };
  }
  if (value.endsWith("-")) {
    return { ok: false, reason: "Darf nicht mit einem Bindestrich enden." };
  }
  if (!SUBDOMAIN_PATTERN.test(value)) {
    return {
      ok: false,
      reason:
        "Nur Kleinbuchstaben, Ziffern und Bindestriche, und nicht mit einem Bindestrich beginnen.",
    };
  }
  if (RESERVED_SUBDOMAINS.has(value)) {
    return { ok: false, reason: "Dieser Name ist reserviert." };
  }

  return { ok: true, value };
}
