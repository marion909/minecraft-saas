import { z } from "zod";

/**
 * Fällt beim Start laut aus, statt später leise das Falsche zu tun.
 * Nur serverseitig importieren — die Werte gehören nie in ein Client-Bundle.
 */

const urlString = z
  .string()
  .refine((value) => URL.canParse(value), "muss eine gültige URL sein");

const schema = z.object({
  DATABASE_URL: urlString,
  REDIS_URL: urlString,

  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "mindestens 32 Zeichen — mit `openssl rand -base64 32` erzeugen"),
  BETTER_AUTH_URL: urlString,

  AGENT_URL: urlString,
  AGENT_TOKEN: z.string().min(8),

  MAIL_TRANSPORT: z.enum(["console", "smtp"]).default("console"),
  MAIL_FROM: z.string().min(3).default("noreply@localhost"),
});

function load() {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `Umgebungsvariablen sind unvollständig oder ungültig:\n${details}\n\n` +
        `Vorlage liegt in .env.example — kopieren nach .env und ausfüllen.`,
    );
  }

  return parsed.data;
}

export const env = load();
