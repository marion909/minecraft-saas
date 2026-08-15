import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "./auth";
import { isAdmin } from "./roles";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** Für Seiten, die eine Anmeldung voraussetzen. */
export async function requireUser() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

/**
 * Für den Admin-Bereich. Bewusst dieselbe Weiterleitung wie bei fehlender
 * Anmeldung — wer kein Admin ist, soll nicht erfahren, dass es die Seite gibt.
 */
export async function requireAdmin() {
  const session = await requireUser();

  if (!isAdmin(session.user.role)) {
    redirect("/dashboard");
  }

  return session;
}
