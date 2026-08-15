import type { ServerResponse } from "node:http";

/**
 * Server-Sent Events statt WebSocket. Der Datenfluss ist einseitig — Logs
 * und Messwerte gehen nur nach unten, Befehle sind einzelne POSTs. Damit
 * braucht weder der Agent noch Next.js eine zweite Protokollschicht.
 */
export class SseStream {
  private readonly response: ServerResponse;
  #closed = false;
  #heartbeat: NodeJS.Timeout;

  constructor(response: ServerResponse) {
    this.response = response;

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Verhindert Pufferung in dazwischenliegenden Proxies.
      "x-accel-buffering": "no",
    });

    // Ein Kommentar alle 20 Sekunden hält die Verbindung offen, wenn gerade
    // nichts passiert — sonst kappen Proxies sie als untätig.
    this.#heartbeat = setInterval(() => this.comment("ping"), 20_000);

    response.on("close", () => this.close());
  }

  get closed(): boolean {
    return this.#closed;
  }

  send(event: string, data: unknown): void {
    if (this.#closed) return;

    const payload = JSON.stringify(data);
    this.response.write(`event: ${event}\ndata: ${payload}\n\n`);
  }

  comment(text: string): void {
    if (this.#closed) return;
    this.response.write(`: ${text}\n\n`);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#heartbeat);
    this.response.end();
  }
}
