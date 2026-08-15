import Link from "next/link";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/status-label";

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
                  {server.subdomain}.{server.node.publicHost}
                </code>
                <span className="hint">
                  {server.plan.name} · {server.appliedMemoryMb} MB RAM ·{" "}
                  {server.serverType} {server.mcVersion}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
