/**
 * Client für die Routen-API von mc-router.
 *
 * Der Router hält seine Routen ausschließlich im Arbeitsspeicher. Nach einem
 * Neustart sind sie weg, obwohl die Container weiterlaufen — dann sind alle
 * Server offline, ohne dass irgendetwas kaputt wäre. Deshalb ist der Abgleich
 * beim Start des Agents kein Extra, sondern Teil des Betriebs.
 */

export type RouteTable = Record<string, { backend: string }>;

export class RouterClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async list(): Promise<RouteTable> {
    const response = await fetch(`${this.baseUrl}/routes`);

    if (!response.ok) {
      throw new Error(`mc-router antwortete ${response.status} auf GET /routes.`);
    }
    return (await response.json()) as RouteTable;
  }

  async set(hostname: string, backend: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/routes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serverAddress: hostname, backend }),
    });

    if (!response.ok) {
      throw new Error(
        `mc-router lehnte die Route ${hostname} ab (${response.status}).`,
      );
    }
  }

  async remove(hostname: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/routes/${encodeURIComponent(hostname)}`,
      { method: "DELETE" },
    );

    // 404 heißt: schon weg. Das ist das gewünschte Ergebnis.
    if (!response.ok && response.status !== 404) {
      throw new Error(
        `mc-router lehnte das Entfernen von ${hostname} ab (${response.status}).`,
      );
    }
  }

  async reachable(): Promise<boolean> {
    try {
      await this.list();
      return true;
    } catch {
      return false;
    }
  }
}

/** Wohin der Router einen Server schickt: Containername im gemeinsamen Netz. */
export function backendFor(containerName: string): string {
  return `${containerName}:25565`;
}
