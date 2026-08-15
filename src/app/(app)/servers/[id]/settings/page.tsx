import Link from "next/link";
import { notFound } from "next/navigation";

import { PropertiesForm } from "@/components/properties-form";
import { VersionForm } from "@/components/version-form";
import { AgentClient } from "@/lib/agent";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireUser();
  const { id } = await params;

  const server = await db.server.findUnique({
    where: { id },
    include: { node: true },
  });

  if (
    !server ||
    (server.userId !== session.user.id && !isAdmin(session.user.role))
  ) {
    notFound();
  }

  const agent = AgentClient.forNode(server.node);

  const [properties, backups] = await Promise.all([
    agent.getProperties(server.id).catch(() => null),
    agent.listBackups(server.id).catch(() => null),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">{server.name}</span>
          <h1>Einstellungen</h1>
        </div>
        <Link className="btn btn-quiet" href={`/servers/${server.id}`}>
          Zurück
        </Link>
      </div>

      {!properties ? (
        <p className="notice notice-warn">
          <code>server.properties</code> ist noch nicht lesbar. Die Datei
          entsteht beim ersten Start des Servers.
        </p>
      ) : (
        <div className="card" style={{ maxWidth: "44rem" }}>
          <PropertiesForm
            serverId={server.id}
            guided={properties.guided}
            values={Object.fromEntries(
              properties.entries.map((entry) => [entry.key, entry.value]),
            )}
          />
        </div>
      )}

      <p className="hint" style={{ maxWidth: "60ch" }}>
        Einstellungen rund um RCON und Ports fehlen hier bewusst: Über sie
        steuert das Panel den Server. Ließen sie sich ändern, könnte ein
        Server sich selbst unerreichbar machen.
      </p>

      <div className="card" style={{ maxWidth: "44rem" }}>
        <h2 style={{ fontSize: "1.05rem" }}>Version und Software</h2>
        <VersionForm
          serverId={server.id}
          currentVersion={server.mcVersion}
          currentType={server.serverType}
          hasBackups={(backups?.backups.length ?? 0) > 0}
        />
      </div>
    </>
  );
}
