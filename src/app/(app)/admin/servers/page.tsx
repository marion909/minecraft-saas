import Link from "next/link";

import { ServerStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { findGame, serverAddress } from "@/lib/games";
import { requireAdmin } from "@/lib/session";
import { formatMb, STATUS_LABEL, STATUS_TONE } from "@/lib/status-label";

/**
 * Alle Server, über alle Konten hinweg.
 *
 * Bewusst ohne Abgleich mit den Agents: Die Übersicht zeigt den zuletzt
 * bekannten Stand aus der Datenbank. Bei jedem Aufruf jeden Container
 * einzeln zu befragen, würde die Seite mit der Anzahl der Server immer
 * langsamer machen — der Abgleich passiert dort, wo er zählt, nämlich
 * beim Öffnen eines einzelnen Servers.
 */
export default async function AdminServersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requireAdmin();

  const { q, status } = await searchParams;
  const suche = (q ?? "").trim();

  const statusFilter =
    status && status in ServerStatus
      ? (status as ServerStatus)
      : undefined;

  const servers = await db.server.findMany({
    where: {
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(suche
        ? {
            OR: [
              { name: { contains: suche, mode: "insensitive" } },
              { subdomain: { contains: suche, mode: "insensitive" } },
              { user: { email: { contains: suche, mode: "insensitive" } } },
              { user: { name: { contains: suche, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, name: true, email: true } },
      node: { select: { name: true, baseDomain: true } },
      plan: { select: { name: true } },
      _count: { select: { backups: true } },
    },
  });

  const gesamt = await db.server.count();

  const belegt = servers.reduce(
    (sum, server) => ({
      memoryMb: sum.memoryMb + server.appliedMemoryMb,
      diskMb: sum.diskMb + server.appliedDiskMb,
    }),
    { memoryMb: 0, diskMb: 0 },
  );

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Verwaltung</span>
          <h1>Alle Server</h1>
        </div>
      </div>

      <p className="muted" style={{ maxWidth: "62ch" }}>
        {gesamt} {gesamt === 1 ? "Server" : "Server"} insgesamt. Ein Klick auf
        den Namen führt in dieselbe Ansicht, die auch der Besitzer sieht —
        samt Konsole, Dateien und Backups. Angezeigt wird der zuletzt bekannte
        Zustand; beim Öffnen eines Servers wird er mit dem Host abgeglichen.
      </p>

      <form className="filterbar" action="/admin/servers">
        <div className="field">
          <label htmlFor="q">Suche</label>
          <input
            id="q"
            name="q"
            defaultValue={suche}
            placeholder="Name, Adresse, Besitzer oder E-Mail"
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label htmlFor="status">Zustand</label>
          <select id="status" name="status" defaultValue={statusFilter ?? ""}>
            <option value="">alle</option>
            {Object.values(ServerStatus).map((value) => (
              <option key={value} value={value}>
                {STATUS_LABEL[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="actions">
          <button className="btn btn-quiet" type="submit">
            Filtern
          </button>
          {suche || statusFilter ? (
            <Link className="btn btn-quiet" href="/admin/servers">
              Zurücksetzen
            </Link>
          ) : null}
        </div>
      </form>

      {servers.length === 0 ? (
        <div className="empty">
          <p style={{ margin: 0 }}>
            {gesamt === 0
              ? "Es gibt noch keine Server."
              : "Kein Server passt auf diese Suche."}
          </p>
        </div>
      ) : (
        <>
          <div className="scroller">
            <table>
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Besitzer</th>
                  <th>Zustand</th>
                  <th>Tarif</th>
                  <th className="num">RAM</th>
                  <th className="num">Platte</th>
                  <th className="num">Backups</th>
                  <th>Node</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((server) => (
                  <tr key={server.id}>
                    <td>
                      <Link href={`/servers/${server.id}`}>
                        <strong>{server.name}</strong>
                      </Link>
                      <br />
                      <code>
                        {(() => {
                          const game = findGame(server.game);
                          return game
                            ? serverAddress(game, server.subdomain, server.node.baseDomain, server.port)
                            : server.subdomain;
                        })()}
                      </code>
                    </td>
                    <td>
                      {server.user.name}
                      <br />
                      <code>{server.user.email}</code>
                    </td>
                    <td>
                      <span className={`chip chip-${STATUS_TONE[server.status]}`}>
                        {STATUS_LABEL[server.status]}
                      </span>
                      {server.lastError ? (
                        <>
                          <br />
                          <span className="hint">{server.lastError}</span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      {server.plan.name}
                      <br />
                      <span className="hint">
                        {findGame(server.game)?.name ?? server.game}
                      </span>
                    </td>
                    <td className="num">{formatMb(server.appliedMemoryMb)}</td>
                    <td className="num">{formatMb(server.appliedDiskMb)}</td>
                    <td className="num">{server._count.backups}</td>
                    <td>{server.node.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="hint">
            {servers.length} angezeigt · zusammen {formatMb(belegt.memoryMb)} RAM
            und {formatMb(belegt.diskMb)} Speicherplatz vergeben
          </p>
        </>
      )}
    </>
  );
}
