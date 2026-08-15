import { headers } from "next/headers";

import { db } from "./db";

export type AuditEntry = {
  action: string;
  userId?: string;
  serverId?: string;
  meta?: Record<string, unknown>;
};

/**
 * Jede administrative Änderung hinterlässt eine Spur. Bewusst ohne throw:
 * ein fehlgeschlagener Log-Eintrag darf die eigentliche Aktion nicht
 * rückgängig machen — dann lieber eine Lücke im Protokoll als ein
 * halb ausgeführter Vorgang.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const requestHeaders = await headers();
    const forwarded = requestHeaders.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() ?? null;

    await db.auditLog.create({
      data: {
        action: entry.action,
        userId: entry.userId ?? null,
        serverId: entry.serverId ?? null,
        ip,
        meta: (entry.meta ?? {}) as never,
      },
    });
  } catch (error) {
    console.error("Audit-Eintrag fehlgeschlagen:", entry.action, error);
  }
}
