import { ServerStatus } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Reicht ein hochgeladenes Backup-Archiv an den Agent durch.
 *
 * Route Handler statt Server Action, aus demselben Grund wie beim
 * Dateimanager: Eine Action puffert den Rumpf vollständig im
 * Arbeitsspeicher, und ein Weltarchiv ist dafür zu groß.
 *
 * Das RCON-Passwort kommt hier dazu und nicht aus dem Browser — der
 * Agent braucht es, um die Welt vor dem Anhalten speichern zu lassen,
 * und es verlässt den Server nie.
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

  // Während des Einrichtens oder Löschens gibt es nichts zu ersetzen —
  // und ein Import mitten hinein hinterließe einen halben Server.
  const gesperrt: ServerStatus[] = [
    ServerStatus.PROVISIONING,
    ServerStatus.DELETING,
    ServerStatus.SUSPENDED,
  ];

  if (gesperrt.includes(server.status)) {
    return new Response(
      "In diesem Zustand lässt sich kein Backup einspielen.",
      { status: 409 },
    );
  }

  if (!request.body) {
    return new Response("Es kam keine Datei an.", { status: 400 });
  }

  const ziel = new URL(
    `${server.node.agentUrl}/servers/${id}/backups/import`,
  );
  ziel.searchParams.set("rconPassword", server.rconPassword);

  const upstream = await fetch(ziel, {
    method: "POST",
    headers: {
      authorization: `Bearer ${server.node.agentToken}`,
      "content-type": "application/octet-stream",
    },
    body: request.body,
    // Ohne das lehnt undici einen Stream-Body ab.
    duplex: "half",
    signal: request.signal,
  } as RequestInit & { duplex: "half" }).catch(() => null);

  if (!upstream) {
    return new Response("Node-Agent nicht erreichbar.", { status: 503 });
  }

  const antwort = await upstream.text();

  if (upstream.ok) {
    // Der Vorgang läuft ab jetzt beim Agent. Der Zustand hier wird
    // vorgezogen, damit die Oberfläche nicht "läuft" zeigt, während der
    // Server gerade angehalten wird.
    await db.server.update({
      where: { id: server.id },
      data: { status: ServerStatus.STOPPING, lastError: null },
    });

    await audit({
      action: "backup.import",
      userId: session.user.id,
      serverId: server.id,
      meta: { bytes: request.headers.get("content-length") ?? "unbekannt" },
    });
  }

  return new Response(antwort, {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}
