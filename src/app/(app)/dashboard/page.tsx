import Link from "next/link";

import { db } from "@/lib/db";
import { findGame, serverAddress } from "@/lib/games";
import { requireUser } from "@/lib/session";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/status-label";

/**
 * Die Adresse, wie ein Spieler sie einträgt. Bei Minecraft reicht der
 * Name, sonst gehört der Port dazu.
 */
function adresse(server: {
  game: string;
  subdomain: string;
  port: number | null;
  node: { baseDomain: string };
}): string {
  const game = findGame(server.game);
  if (!game) return server.subdomain;
  return serverAddress(game, server.subdomain, server.node.baseDomain, server.port);
}

export default async function DashboardPage() {
  const session = await requireUser();

  const servers = await db.server.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: { plan: true, node: true },
  });

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Deine Server</span>
          <h1>Übersicht</h1>
        </div>
        <Link className="btn btn-primary" href="/servers/new">
          Server anlegen
        </Link>
      </div>

      {servers.length === 0 ? (
        <div className="empty">
          <p style={{ margin: 0 }}>Noch kein Server angelegt.</p>
          <p className="hint" style={{ maxWidth: "34rem" }}>
            Ein Server ist in etwa einer Minute bereit — die meiste Zeit davon
            braucht Minecraft, um die Welt zu erzeugen.
          </p>
          <Link className="btn btn-primary" href="/servers/new">
            Ersten Server anlegen
          </Link>
        </div>
      ) : (
        <ul className="server-list">
          {servers.map((server) => (
            <li key={server.id}>
              <Link className="server-card" href={`/servers/${server.id}`}>
                <span className="server-card-head">
                  <strong>{server.name}</strong>
                  <span className={`chip chip-${STATUS_TONE[server.status]}`}>
                    {STATUS_LABEL[server.status]}
                  </span>
                </span>
                <code className="server-card-addr">
                  {adresse(server)}
                </code>
                <span className="hint">
                  {findGame(server.game)?.name ?? server.game} ·{" "}
                  {server.plan.name} · {server.appliedMemoryMb} MB RAM
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
