import { defineConfig, env } from "prisma/config";

// Prisma 7 lädt .env nicht mehr von allein.
try {
  process.loadEnvFile();
} catch {
  // Keine .env vorhanden — dann müssen die Variablen bereits gesetzt sein.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
