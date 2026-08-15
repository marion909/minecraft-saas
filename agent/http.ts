import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export type Handler = (context: {
  request: IncomingMessage;
  response: ServerResponse;
  params: Record<string, string>;
  body: unknown;
}) => Promise<unknown> | unknown;

type Route = {
  method: string;
  segments: string[];
  handler: Handler;
};

export class Router {
  #routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    this.#routes.push({
      method,
      segments: pattern.split("/").filter(Boolean),
      handler,
    });
    return this;
  }

  get(pattern: string, handler: Handler) {
    return this.add("GET", pattern, handler);
  }
  post(pattern: string, handler: Handler) {
    return this.add("POST", pattern, handler);
  }
  put(pattern: string, handler: Handler) {
    return this.add("PUT", pattern, handler);
  }
  patch(pattern: string, handler: Handler) {
    return this.add("PATCH", pattern, handler);
  }
  delete(pattern: string, handler: Handler) {
    return this.add("DELETE", pattern, handler);
  }

  match(
    method: string,
    pathname: string,
  ): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split("/").filter(Boolean);

    for (const route of this.#routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;

      const params: Record<string, string> = {};
      let matched = true;

      for (const [index, segment] of route.segments.entries()) {
        const value = parts[index] ?? "";

        if (segment.startsWith(":")) {
          params[segment.slice(1)] = decodeURIComponent(value);
        } else if (segment !== value) {
          matched = false;
          break;
        }
      }

      if (matched) return { handler: route.handler, params };
    }

    return null;
  }
}

/** Fehler mit HTTP-Status, damit Handler nicht selbst antworten müssen. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Vergleich in konstanter Zeit. Ein naives `===` verrät über die Laufzeit,
 * wie viele Zeichen stimmen — bei einem Token, das Root auf dem Host bedeutet,
 * ist das keine theoretische Sorge.
 */
export function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  if (a.length !== b.length) {
    // Trotzdem einmal vergleichen, damit die Laufzeit nicht von der Länge abhängt.
    timingSafeEqual(b, b);
    return false;
  }

  return timingSafeEqual(a, b);
}

export function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim();
}

export async function readJsonBody(
  request: IncomingMessage,
  limitBytes = 1024 * 512,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limitBytes) {
      throw new HttpError(413, "Anfrage zu groß.");
    }
    chunks.push(chunk as Buffer);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Ungültiges JSON.");
  }
}

export function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}
