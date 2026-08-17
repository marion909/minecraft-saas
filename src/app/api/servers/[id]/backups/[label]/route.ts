import { AgentClient } from "@/lib/agent";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Reicht ein Backup-Archiv vom Agent an den Browser durch.
 *
 * Als Route Handler und nicht als Server Action: Actions puffern ihre
 * Antwort vollständig im Arbeitsspeicher, und ein Weltarchiv bringt das
 * Panel damit um. Hier fließt der Strom durch, ohne je ganz da zu sein.
 *
 * Der Agent selbst ist nur lokal erreichbar und trägt ein Token, das
 * root auf dem Host bedeutet — der Browser spricht ihn nie direkt an.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; label: string }> },
) {
  const { id, label } = await params;
  const session = await getSession();

  if (!session) return new Response("Nicht angemeldet.", { status: 401 });

  const server = await db.server.findUnique({
    where: { id },
    include: { node: true },
  });

  // Fremde Server verhalten sich wie nicht vorhandene.
  if (
    !server ||
    (server.userId !== session.user.id && !isAdmin(session.user.role))
  ) {
    return new Response("Nicht gefunden.", { status: 404 });
  }

  // Dieselbe Prüfung wie beim Agent, hier nur, um eine unnötige Anfrage
  // zu sparen und einen lesbaren Fehler zu liefern.
  if (!/^[A-Za-z0-9._-]+$/.test(label)) {
    return new Response("Ungültige Backup-Kennung.", { status: 400 });
  }

  const agent = AgentClient.forNode(server.node);

  let upstream: Response;

  try {
    upstream = await fetch(agent.archiveUrl(server.id, label), {
      headers: { authorization: agent.authHeader },
      // Bricht der Nutzer den Download ab, endet auch das Packen auf
      // dem Host — sonst liefe tar für eine Datei weiter, die niemand
      // mehr entgegennimmt.
      signal: request.signal,
      cache: "no-store",
    });
  } catch {
    return new Response("Node-Agent nicht erreichbar.", { status: 503 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(
      await upstream.text().catch(() => "Backup konnte nicht gelesen werden."),
      { status: upstream.status },
    );
  }

  // Der Dateiname, unter dem es im Download-Ordner landet: Servername
  // und Zeitpunkt, damit drei heruntergeladene Backups unterscheidbar
  // bleiben. Nur Unbedenkliches, der Rest wird ersetzt.
  const sauber = server.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const dateiname = `${sauber || "server"}-${label}.tar.gz`;

  const laenge = upstream.headers.get("content-length");

  return new Response(upstream.body, {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${dateiname}"`,
      ...(laenge ? { "content-length": laenge } : {}),
      "cache-control": "no-store",
    },
  });
}
