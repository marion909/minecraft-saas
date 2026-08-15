import { z } from "zod";

/**
 * Die Untergrenze bei memoryMb ist keine Willkür: Aus dem Container-Limit
 * wird der JVM-Heap abgeleitet (heapForContainer in capacity.ts), und
 * darunter bliebe nach dem JVM-Overhead kein brauchbarer Heap übrig.
 */
export const PLAN_MIN_MEMORY_MB = 1280;

export const planInput = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Mindestens 2 Zeichen.")
    .max(40, "Höchstens 40 Zeichen."),

  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9][a-z0-9-]{1,30}$/,
      "Nur Kleinbuchstaben, Ziffern und Bindestriche, 2–31 Zeichen, Beginn nicht mit Bindestrich.",
    ),

  memoryMb: z.coerce
    .number()
    .int("Ganze Zahl.")
    .min(
      PLAN_MIN_MEMORY_MB,
      `Mindestens ${PLAN_MIN_MEMORY_MB} MB — darunter bleibt nach dem JVM-Overhead kein nutzbarer Heap.`,
    )
    .max(65_536, "Höchstens 64 GB."),

  cpuCores: z.coerce
    .number()
    .min(0.5, "Mindestens 0,5 Kerne.")
    .max(32, "Höchstens 32 Kerne."),

  diskMb: z.coerce
    .number()
    .int("Ganze Zahl.")
    .min(1024, "Mindestens 1 GB.")
    .max(2_000_000, "Höchstens 2 TB."),

  maxPlayers: z.coerce
    .number()
    .int("Ganze Zahl.")
    .min(1, "Mindestens 1 Spieler.")
    .max(500, "Höchstens 500 Spieler."),

  maxBackups: z.coerce
    .number()
    .int("Ganze Zahl.")
    .min(0, "Nicht negativ.")
    .max(100, "Höchstens 100 Backups."),

  maxServers: z.coerce
    .number()
    .int("Ganze Zahl.")
    .min(1, "Mindestens 1 Server.")
    .max(20, "Höchstens 20 Server."),

  priceCents: z.coerce
    .number()
    .int("Ganze Zahl.")
    .min(0, "Nicht negativ.")
    .max(1_000_000, "Unrealistisch hoch."),

  isPublic: z.coerce.boolean(),
});

export type PlanInput = z.infer<typeof planInput>;

/** Wandelt FormData in das Eingabeobjekt — Checkboxen kommen nur mit, wenn gesetzt. */
export function planInputFromForm(formData: FormData) {
  return planInput.safeParse({
    name: formData.get("name") ?? "",
    slug: formData.get("slug") ?? "",
    memoryMb: formData.get("memoryMb") ?? "",
    cpuCores: formData.get("cpuCores") ?? "",
    diskMb: formData.get("diskMb") ?? "",
    maxPlayers: formData.get("maxPlayers") ?? "",
    maxBackups: formData.get("maxBackups") ?? "",
    maxServers: formData.get("maxServers") ?? "",
    priceCents: formData.get("priceCents") ?? "",
    isPublic: formData.get("isPublic") === "on",
  });
}

/** Feldbezogene Fehlermeldungen für die Anzeige am jeweiligen Eingabefeld. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};

  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && result[key] === undefined) {
      result[key] = issue.message;
    }
  }

  return result;
}
