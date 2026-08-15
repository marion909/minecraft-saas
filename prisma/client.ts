import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client.ts";

/**
 * Client für Skripte, die außerhalb von Next.js laufen (Seed, CLI-Werkzeuge).
 * Die App selbst nutzt src/lib/db.ts mit dem geprüften env-Objekt.
 */
export function createClient(): PrismaClient {
  try {
    process.loadEnvFile();
  } catch {
    // Keine .env — dann müssen die Variablen von außen kommen.
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL fehlt. .env aus .env.example anlegen oder Variable setzen.",
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}
