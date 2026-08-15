import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

/**
 * Im Dev-Modus lädt Next.js Module bei jedem Hot-Reload neu. Ohne diesen
 * Singleton entstünde pro Reload ein neuer Pool, bis Postgres die
 * Verbindungen ablehnt.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Ab Prisma 7 kommt die Verbindung über einen Treiber-Adapter,
    // nicht mehr über die datasource-URL im Schema.
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
