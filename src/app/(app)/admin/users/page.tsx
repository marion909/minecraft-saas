import Link from "next/link";

import { DeleteUserButton } from "@/components/delete-user-button";
import { RoleSelect } from "@/components/role-select";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/roles";
import { requireAdmin } from "@/lib/session";

function datum(value: Date): string {
  return value.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default async function UsersPage() {
  const session = await requireAdmin();

  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { servers: true } } },
  });

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Verwaltung</span>
          <h1>Konten</h1>
        </div>
        <Link className="btn btn-primary" href="/admin/users/new">
          Konto anlegen
        </Link>
      </div>

      <p className="muted" style={{ maxWidth: "62ch" }}>
        Die öffentliche Registrierung ist abgeschaltet — Konten entstehen nur
        hier. Ein hier angelegtes Konto gilt sofort als bestätigt und braucht
        keine Mail. Löschen geht erst, wenn die Person keine Server mehr hat:
        Welten und Sicherungen sollen nicht als Nebenwirkung verschwinden.
      </p>

      <div className="scroller">
        <table>
          <thead>
            <tr>
              <th>Konto</th>
              <th>Rolle</th>
              <th>Bestätigt</th>
              <th>Server</th>
              <th>Angelegt</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.name}</strong>
                  <br />
                  <code>{user.email}</code>
                  {user.banned ? (
                    <>
                      {" "}
                      <span className="chip chip-bad">gesperrt</span>
                    </>
                  ) : null}
                </td>
                <td>
                  {user.id === session.user.id ? (
                    // Die eigene Rolle nicht über die Oberfläche ändern
                    // können: Ein Fehlklick sperrte sonst genau die Person
                    // aus, die es wieder geradebiegen müsste.
                    <span className="chip">
                      {isAdmin(user.role) ? "Admin" : "Nutzer"} · du
                    </span>
                  ) : (
                    <RoleSelect userId={user.id} role={user.role} />
                  )}
                </td>
                <td>
                  {user.emailVerified ? (
                    <span className="chip chip-ok">ja</span>
                  ) : (
                    <span className="chip chip-warn">nein</span>
                  )}
                </td>
                <td className="num">{user._count.servers}</td>
                <td className="num">{datum(user.createdAt)}</td>
                <td>
                  {user.id === session.user.id ? null : (
                    <DeleteUserButton
                      userId={user.id}
                      name={user.name}
                      email={user.email}
                      serverCount={user._count.servers}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
