import { db } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Reicht einen Upload an den Agent durch. Bewusst als Route Handler und
 * nicht als Server Action: Actions puffern den Body vollständig im
 * Arbeitsspeicher, ein Modpack von 200 MB würde das Panel umbringen.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession();

  if (!session) return new Response("Nicht angemeldet.", { status: 401 });

  const server = await db.server.findUnique({
    where: { id },
    include: { node: true },
  });

  if (
    !server ||
    (server.userId !== session.user.id && !isAdmin(session.user.role))
  ) {
    return new Response("Nicht gefunden.", { status: 404 });
  }

  const path = new URL(request.url).searchParams.get("path");
  if (!path) return new Response("Pfad fehlt.", { status: 400 });

  const upstream = await fetch(
    `${server.node.agentUrl}/servers/${id}/upload?path=${encodeURIComponent(path)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${server.node.agentToken}`,
        "content-type": "application/octet-stream",
      },
      body: request.body,
      // Ohne das lehnt undici einen Stream-Body ab.
      duplex: "half",
      signal: request.signal,
    } as RequestInit & { duplex: "half" },
  ).catch(() => null);

  if (!upstream) {
    return new Response("Node-Agent nicht erreichbar.", { status: 503 });
  }

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}
