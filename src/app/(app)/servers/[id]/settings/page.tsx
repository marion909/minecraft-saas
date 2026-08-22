import Link from "next/link";
import { notFound } from "next/navigation";

import { PropertiesForm } from "@/components/properties-form";
import { RecreateContainerForm } from "@/components/recreate-container-form";
import { VersionForm } from "@/components/version-form";
import { AgentClient } from "@/lib/agent";
import { ForeignServerNotice } from "@/components/foreign-server-notice";
import { db } from "@/lib/db";
import { findGame } from "@/lib/games";
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
    include: {
      node: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });

  if (
    !server ||
    (server.userId !== session.user.id && !isAdmin(session.user.role))
  ) {
    notFound();
  }

  const spiel = findGame(server.game);

  const agent = AgentClient.forNode(server.node);

  // server.properties ist eine Minecraft-Datei. Bei allen anderen Spielen
  // schlaegt der Aufruf zuverlaessig fehl, und die Seite versprach dann,
  // die Datei entstehe beim ersten Start — sie entsteht nie.
  const [properties, backups] = await Promise.all([
    spiel?.id === "minecraft"
      ? agent.getProperties(server.id).catch(() => null)
      : Promise.resolve(null),
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

      {server.userId !== session.user.id ? (
        <ForeignServerNotice owner={server.user} />
      ) : null}

      {spiel?.id !== "minecraft" ? null : !properties ? (
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

      {/*
        Nur für Spiele mit Varianten — bei allen anderen gäbe es hier
        Paper, Vanilla und Purpur zur Auswahl, die es dort nicht gibt.
        Der Weg dahinter ist ebenfalls noch Minecraft: recreate baut den
        Container ohne Spiel und ohne Port neu, aus einem CS2-Server
        würde dabei ein Minecraft-Server.
      */}
      <div className="card" style={{ maxWidth: "44rem" }}>
        <h2 style={{ fontSize: "1.05rem" }}>Container</h2>
        <RecreateContainerForm serverId={server.id} />
      </div>

      {spiel?.variants ? (
        <div className="card" style={{ maxWidth: "44rem" }}>
          <h2 style={{ fontSize: "1.05rem" }}>Version und Software</h2>
          <VersionForm
            serverId={server.id}
            currentVersion={server.mcVersion}
            currentType={server.serverType}
            variants={spiel.variants}
            hasBackups={(backups?.backups.length ?? 0) > 0}
          />
        </div>
      ) : (
        <div className="card" style={{ maxWidth: "44rem" }}>
          <h2 style={{ fontSize: "1.05rem" }}>Version</h2>
          <p className="hint">
            {spiel?.name ?? "Dieses Spiel"} lädt beim Start die aktuelle
            Fassung — eine Auswahl gibt es hier noch nicht. Server-Software
            wie Paper oder Fabric ist eine Minecraft-Frage.
          </p>
        </div>
      )}
    </>
  );
}
