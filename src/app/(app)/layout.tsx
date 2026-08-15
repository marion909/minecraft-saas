import Link from "next/link";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/sign-out-button";
import { isAdmin } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireUser();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/dashboard">
            Minecraft SaaS
          </Link>

          <Link className="navlink" href="/dashboard">
            Server
          </Link>

          {isAdmin(session.user.role) ? (
            <>
              <Link className="navlink" href="/admin">
                Admin
              </Link>
              {/*
                Die drei Wege, die ein Admin täglich braucht — alles
                andere (Tarife, Konten) liegt eine Ebene tiefer unter
                /admin. Server und Host stehen hier, weil man sie im
                Zweifel schnell braucht.
              */}
              <Link className="navlink" href="/admin/servers">
                Alle Server
              </Link>
              <Link className="navlink" href="/admin/host">
                Host
              </Link>
            </>
          ) : null}

          <SignOutButton />
        </div>
      </header>

      <div className="content">{children}</div>
    </div>
  );
}
