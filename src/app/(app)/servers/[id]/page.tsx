import Link from "next/link";
import { notFound } from "next/navigation";

import { ServerStatus } from "@/generated/prisma/enums";
import { DeleteServerForm } from "@/components/delete-server-form";
import { ForeignServerNotice } from "@/components/foreign-server-notice";
import { ServerConsole } from "@/components/server-console";
import { ServerControls } from "@/components/server-controls";
import { ServerLog } from "@/components/server-log";
import { ServerStats } from "@/components/server-stats";
import { AgentClient } from "@/lib/agent";
import { db } from "@/lib/db";
import { findGame, serverAddress } from "@/lib/games";
import { portsOf } from "@/lib/ports";
import { isAdmin } from "@/lib/roles";
import { requireUser } from "@/lib/session";
import { syncServer } from "@/lib/server-sync";
import { formatBytes, STATUS_LABEL, STATUS_TONE } from "@/lib/status-label";

export default async function ServerPage({
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
      plan: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });

  // Fremde Server verhalten sich wie nicht vorhandene — die ID in der URL
  // darf nichts über andere Konten verraten.
  if (
    !server ||
    (server.userId !== session.user.id && !isAdmin(session.user.role))
  ) {
    notFound();
  }

  const live = await syncServer(server);
  const game = findGame(server.game);
  const address = game
    ? serverAddress(game, server.subdomain, server.node.baseDomain, server.port)
    : server.subdomain;
  const tone = STATUS_TONE[live.status];

  // Nur fragen, wenn es etwas zu erreichen gibt — sonst wartet die Seite
  // unnötig auf einen Ping, der ohnehin scheitert.
  // Der Erreichbarkeitstest spricht das Minecraft-Protokoll. Für andere
  // Spiele gibt es kein Gegenstück, das ohne eigenen Client auskäme —
  // dort bleibt es beim Zustand des Containers.
  //
  // Das Ergebnis muss von "gar nicht geprüft" unterscheidbar sein.
  // Sonst zeigt die Seite denselben Satz für zwei sehr verschiedene
  // Lagen: einmal "geprüft, antwortet nicht", einmal "nie geprüft".
  const prüfbar = game?.routing === "hostname";

  const reachability =
    prüfbar && live.agentReachable && live.status === ServerStatus.RUNNING
      ? await AgentClient.forNode(server.node)
          .ping(server.id)
          .catch(() => null)
      : null;

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Server</span>
          <h1>{server.name}</h1>
        </div>
        <span className={`chip chip-${tone}`}>{STATUS_LABEL[live.status]}</span>
      </div>

      <nav className="actions">
        <Link className="btn btn-quiet" href={`/servers/${server.id}/files`}>
          Dateien
        </Link>
        <Link className="btn btn-quiet" href={`/servers/${server.id}/settings`}>
          Einstellungen
        </Link>
        <Link className="btn btn-quiet" href={`/servers/${server.id}/backups`}>
          Backups
        </Link>
      </nav>

      {server.userId !== session.user.id ? (
        <ForeignServerNotice owner={server.user} />
      ) : null}

      {!live.agentReachable ? (
        <p className="notice notice-warn">
          Der Node-Agent antwortet gerade nicht ({live.agentError}). Angezeigt
          wird der zuletzt bekannte Stand; Aktionen schlagen bis dahin fehl.
        </p>
      ) : null}

      {server.lastError ? (
        <p className="notice notice-error">{server.lastError}</p>
      ) : null}

      <div className="card">
        <h2 style={{ fontSize: "1.05rem" }}>Adresse</h2>
        <p className="address-big">
          <code>{address}</code>
        </p>

        {reachability?.reachable ? (
          <>
            <p className="notice">
              Erreichbar — geprüft so, wie ein Minecraft-Client es tut.
            </p>
            <div className="scroller">
              <table>
                <tbody>
                  <tr>
                    <th scope="row">Spieler online</th>
                    <td className="num">
                      {reachability.playersOnline} / {reachability.playersMax}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Version</th>
                    <td>{reachability.version}</td>
                  </tr>
                  <tr>
                    <th scope="row">MOTD</th>
                    <td>{reachability.motd}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        ) : prüfbar && live.status === ServerStatus.RUNNING ? (
          <p className="notice notice-warn">
            Der Server läuft, ist unter dieser Adresse aber nicht erreichbar
            {reachability?.reason ? ` (${reachability.reason})` : ""}. Meist
            fehlt der DNS-Eintrag für <code>*.{game?.slug}.{server.node.baseDomain}</code>.
          </p>
        ) : live.status === ServerStatus.RUNNING ? (
          /*
            Hier stand bis eben dieselbe Warnung wie eine Zeile darüber —
            obwohl für dieses Spiel nie geprüft wurde. Eine ausgelassene
            Messung als Fehlschlag anzuzeigen, schickt Leute auf die
            Suche nach einem DNS-Eintrag, der längst da ist.
          */
          <p className="hint">
            Ob der Server von außen antwortet, prüft das Panel hier nicht:
            Der Test spricht das Minecraft-Protokoll, und {game?.name} kennt
            kein Gegenstück, das ohne eigenen Client auskäme. Zum Verbinden
            gehören zwei Dinge, die außerhalb dieses Panels liegen — der
            DNS-Eintrag{" "}
            <code>
              *.{game?.slug}.{server.node.baseDomain}
            </code>{" "}
            und die Weiterleitung von Port{" "}
            {game && server.port ? portsOf(game, server.port).join(" und ") : server.port}{" "}
            im Router.
          </p>
        ) : (
          <p className="hint">
            Diese Adresse tragen Spieler im Spiel ein. Sie antwortet, sobald
            der Server läuft.
            {game && game.routing === "port" ? (
              <>
                {" "}
                Der Port gehört dazu — {game.name} unterscheidet Server
                ausschließlich daran. Er muss im Router auf diesen Host
                weitergeleitet sein.
              </>
            ) : null}
          </p>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1.05rem" }}>Steuerung</h2>
        <ServerControls serverId={server.id} status={live.status} />
      </div>

      {live.status === ServerStatus.RUNNING ? (
        <div className="card">
          <h2 style={{ fontSize: "1.05rem" }}>Auslastung</h2>
          <ServerStats
            serverId={server.id}
            cpuCores={server.appliedCpuCores}
          />
        </div>
      ) : null}

      <div className="card">
        <h2 style={{ fontSize: "1.05rem" }}>Konsole</h2>
        <ServerConsole
          serverId={server.id}
          enabled={live.status === ServerStatus.RUNNING && live.ready}
        />
      </div>

      {live.status !== ServerStatus.STOPPED &&
      live.status !== ServerStatus.PROVISIONING ? (
        <div className="card">
          <h2 style={{ fontSize: "1.05rem" }}>Log</h2>
          <ServerLog serverId={server.id} />
        </div>
      ) : null}

      <div className="card">
        <h2 style={{ fontSize: "1.05rem" }}>Ausstattung</h2>
        <div className="scroller">
          <table>
            <tbody>
              <tr>
                <th scope="row">Spiel</th>
                <td>{game?.name ?? server.game}</td>
              </tr>
              <tr>
                <th scope="row">Tarif</th>
                <td>{server.plan.name}</td>
              </tr>
              <tr>
                <th scope="row">Arbeitsspeicher</th>
                <td className="num">{server.appliedMemoryMb} MB</td>
              </tr>
              <tr>
                <th scope="row">CPU</th>
                <td className="num">{server.appliedCpuCores} Kerne</td>
              </tr>
              <tr>
                <th scope="row">Speicherplatz</th>
                <td className="num">
                  {formatBytes(live.usedBytes)} von {server.appliedDiskMb} MB
                </td>
              </tr>
              {game?.variants ? (
                <tr>
                  <th scope="row">Software</th>
                  <td>
                    {server.serverType} {server.mcVersion}
                  </td>
                </tr>
              ) : null}
              {server.port !== null ? (
                <tr>
                  <th scope="row">Port</th>
                  <td className="num">
                    {game ? portsOf(game, server.port).join(", ") : server.port}
                  </td>
                </tr>
              ) : null}
              <tr>
                <th scope="row">Angelegt</th>
                <td>{server.createdAt.toLocaleDateString("de-DE")}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {server.appliedMemoryMb !== server.plan.memoryMb ? (
          <p className="notice notice-warn">
            Der Tarif wurde geändert. Dieser Server läuft noch mit den alten
            Grenzen ({server.appliedMemoryMb} MB statt {server.plan.memoryMb} MB)
            und übernimmt die neuen erst, wenn sein Container neu erstellt wird.
          </p>
        ) : null}
      </div>

      <div className="card danger-zone">
        <h2 style={{ fontSize: "1.05rem" }}>Server löschen</h2>
        <p className="muted">
          Entfernt den Container und alle Weltdaten. Backups verschwinden
          ebenfalls. Das lässt sich nicht rückgängig machen.
        </p>
        <DeleteServerForm serverId={server.id} serverName={server.name} />
      </div>

      <p>
        <Link href="/dashboard">Zurück zur Übersicht</Link>
      </p>
    </>
  );
}
