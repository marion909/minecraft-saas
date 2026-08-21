import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client.ts";

/**
 * Client für Skripte, die außerhalb von Next.js laufen (Seed, CLI-Werkzeuge).
 * Die App selbst nutzt src/lib/db.ts mit dem geprüften env-Objekt.
 */
export function createClient(): PrismaClient {
  // Warum die .env nicht geladen werden konnte, gehört in die
  // Fehlermeldung. "Fehlt" und "darf ich nicht lesen" sehen sonst gleich
  // aus — und auf einem eingerichteten Host ist es fast immer das
  // zweite: Die Datei gehört root, weil Geheimnisse darin stehen.
  let envProblem: string | null = null;

  try {
    process.loadEnvFile();
  } catch (error) {
    const code = (error as { code?: string }).code;
    envProblem =
      code === "EACCES"
        ? "die .env liegt da, ist aber für diesen Benutzer nicht lesbar"
        : "es wurde keine .env gefunden";
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      `DATABASE_URL fehlt${envProblem ? ` — ${envProblem}` : ""}. ` +
        `Auf einem eingerichteten Host stehen die Geheimnisse in einer ` +
        `.env, die root gehört: dann mit sudo aufrufen und aus dem ` +
        `Verzeichnis der App heraus.`,
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}
