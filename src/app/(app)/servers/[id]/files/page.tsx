import Link from "next/link";
import { notFound } from "next/navigation";

import { FileActions } from "@/components/file-actions";
import { FileEditor } from "@/components/file-editor";
import { AgentClient } from "@/lib/agent";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { requireUser } from "@/lib/session";
import { formatBytes } from "@/lib/status-label";

function crumbsFor(path: string): { label: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  const crumbs = [{ label: "Serverdateien", path: "" }];

  let running = "";
  for (const part of parts) {
    running = running ? `${running}/${part}` : part;
    crumbs.push({ label: part, path: running });
  }
  return crumbs;
}

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ path?: string; file?: string }>;
}) {
  const session = await requireUser();
  const { id } = await params;
  const query = await searchParams;

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

  // Einzeldatei zum Bearbeiten
  if (query.file) {
    const content = await agent.readFile(server.id, query.file).catch(() => null);
    const parent = query.file.split("/").slice(0, -1).join("/");

    return (
      <>
        <div className="page-head">
          <div>
            <span className="eyebrow">{server.name}</span>
            <h1>{query.file.split("/").pop()}</h1>
          </div>
          <Link
            className="btn btn-quiet"
            href={`/servers/${server.id}/files?path=${encodeURIComponent(parent)}`}
          >
            Zurück
          </Link>
        </div>

        {!content ? (
          <p className="notice notice-error">Datei konnte nicht gelesen werden.</p>
        ) : content.kind === "text" ? (
          <div className="card">
            <FileEditor
              serverId={server.id}
              path={content.path}
              initial={content.content}
            />
          </div>
        ) : (
          <p className="notice notice-warn">
            {content.kind === "binary"
              ? "Das ist keine Textdatei — sie lässt sich hier nicht bearbeiten."
              : `Die Datei ist mit ${formatBytes(content.sizeBytes)} zu groß für den Editor.`}
          </p>
        )}
      </>
    );
  }

  const path = query.path ?? "";
  const listing = await agent.listFiles(server.id, path).catch(() => null);

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">{server.name}</span>
          <h1>Dateien</h1>
        </div>
        <Link className="btn btn-quiet" href={`/servers/${server.id}`}>
          Zurück zum Server
        </Link>
      </div>

      <nav className="crumbs" aria-label="Pfad">
        {crumbsFor(path).map((crumb, index, all) => (
          <span key={crumb.path}>
            {index > 0 ? <span className="crumb-sep">/</span> : null}
            {index === all.length - 1 ? (
              <span className="crumb-current">{crumb.label}</span>
            ) : (
              <Link
                href={`/servers/${server.id}/files?path=${encodeURIComponent(crumb.path)}`}
              >
                {crumb.label}
              </Link>
            )}
          </span>
        ))}
      </nav>

      <FileActions serverId={server.id} path={path} />

      {!listing ? (
        <p className="notice notice-error">
          Verzeichnis konnte nicht gelesen werden.
        </p>
      ) : (
        <>
          {listing.truncated ? (
            <p className="notice notice-warn">
              Nur die ersten 500 Einträge werden angezeigt.
            </p>
          ) : null}

          <div className="scroller">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Größe</th>
                  <th>Geändert</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {path ? (
                  <tr>
                    <td colSpan={4}>
                      <Link
                        href={`/servers/${server.id}/files?path=${encodeURIComponent(
                          path.split("/").slice(0, -1).join("/"),
                        )}`}
                      >
                        ↑ eine Ebene höher
                      </Link>
                    </td>
                  </tr>
                ) : null}

                {listing.entries.map((entry) => {
                  const childPath = path ? `${path}/${entry.name}` : entry.name;

                  return (
                    <tr key={entry.name}>
                      <td>
                        {entry.type === "directory" ? (
                          <Link
                            href={`/servers/${server.id}/files?path=${encodeURIComponent(childPath)}`}
                          >
                            📁 {entry.name}
                          </Link>
                        ) : entry.type === "file" ? (
                          <Link
                            href={`/servers/${server.id}/files?file=${encodeURIComponent(childPath)}`}
                          >
                            {entry.name}
                          </Link>
                        ) : (
                          <span className="muted">{entry.name}</span>
                        )}
                      </td>
                      <td className="num">
                        {entry.type === "directory"
                          ? "—"
                          : formatBytes(entry.sizeBytes)}
                      </td>
                      <td className="num">
                        {new Date(entry.modifiedAt).toLocaleString("de-DE")}
                      </td>
                      <td>
                        {entry.editable ? (
                          <FileActions
                            serverId={server.id}
                            path={path}
                            deleteTarget={childPath}
                          />
                        ) : (
                          <span className="chip chip-off">geschützt</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
