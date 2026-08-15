import { db } from "./db";
import { isAdmin } from "./roles";
import { getSession } from "./session";

/**
 * Reicht einen Stream des Agents an den Browser durch.
 *
 * Der Agent ist nur lokal erreichbar und trägt ein Token, das Root auf dem
 * Host bedeutet — der Browser darf ihn niemals direkt ansprechen. Deshalb
 * dieser Umweg, und deshalb steht die Eigentumsprüfung davor.
 */
export async function proxyAgentStream(
  request: Request,
  serverId: string,
  path: string,
): Promise<Response> {
  const session = await getSession();

  if (!session) {
    return new Response("Nicht angemeldet.", { status: 401 });
  }

  const server = await db.server.findUnique({
    where: { id: serverId },
    include: { node: true },
  });

  // Fremde Server verhalten sich wie nicht vorhandene.
  if (
    !server ||
    (server.userId !== session.user.id && !isAdmin(session.user.role))
  ) {
    return new Response("Nicht gefunden.", { status: 404 });
  }

  let upstream: Response;

  try {
    upstream = await fetch(`${server.node.agentUrl}${path}`, {
      headers: { authorization: `Bearer ${server.node.agentToken}` },
      // Bricht der Browser ab, endet auch der Stream beim Agent — sonst
      // bliebe pro geschlossenem Tab eine offene Verbindung am
      // Docker-Daemon hängen.
      signal: request.signal,
      cache: "no-store",
    });
  } catch {
    return new Response("Node-Agent nicht erreichbar.", { status: 503 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(await upstream.text().catch(() => "Fehler."), {
      status: upstream.status,
    });
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

/** Ersetzt das RCON-Passwort aus der Datenbank — es verlässt den Server nie. */
export async function agentPasswordFor(
  serverId: string,
): Promise<string | null> {
  const server = await db.server.findUnique({
    where: { id: serverId },
    select: { rconPassword: true },
  });

  return server?.rconPassword ?? null;
}
