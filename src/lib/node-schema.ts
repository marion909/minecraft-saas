import { z } from "zod";

/**
 * Ein Node ist ein Linux-Host mit Agent, Docker und Speicher.
 *
 * Die Zahlen hier sind Buchhaltung, keine Messung: Sie sagen, wie viel
 * das Panel vergeben darf, nicht wie viel wirklich verbaut ist. Trägt
 * jemand mehr ein, als der Host hat, merkt das niemand — bis der
 * OOM-Killer den ersten Spielserver mitten im Spiel abräumt. Deshalb
 * sind die Grenzen hier eng und die Fehlermeldungen erklärend.
 */

/** Unter 2 GB bleibt nach Reserve kein Tarif mehr übrig, der startet. */
export const NODE_MIN_MEMORY_MB = 2048;

export const nodeInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Mindestens 2 Zeichen.")
      .max(40, "Höchstens 40 Zeichen."),

    // z.url() lässt auch ftp:// und mailto: durch — geprüft, nicht
    // angenommen. Deshalb die zusätzliche Bedingung auf das Schema.
    agentUrl: z
      .string()
      .trim()
      .pipe(z.url("Vollständige Adresse mit Schema, z. B. http://127.0.0.1:8787."))
      .refine((value) => /^https?:\/\//i.test(value), "Nur http oder https.")
      .refine(
        (value) => !value.endsWith("/"),
        "Ohne abschließenden Schrägstrich — der Client hängt die Pfade selbst an.",
      ),

    /**
     * Beim Bearbeiten leer = unverändert. Deshalb hier optional und die
     * Pflicht erst in der Aktion, die das Anlegen macht — ein Formular,
     * das den Token zum Ändern des Arbeitsspeichers erneut verlangt,
     * lädt dazu ein, ihn irgendwo zwischenzuspeichern.
     */
    agentToken: z
      .string()
      .trim()
      .min(16, "Mindestens 16 Zeichen — das Token bedeutet root auf dem Host.")
      .max(200, "Höchstens 200 Zeichen.")
      .or(z.literal("")),

    publicHost: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
        "Vollständiger Name mit Punkt, z. B. mc.example.com — ohne Schema und ohne Port.",
      ),

    totalMemoryMb: z.coerce
      .number()
      .int("Ganze Zahl.")
      .min(NODE_MIN_MEMORY_MB, `Mindestens ${NODE_MIN_MEMORY_MB} MB.`)
      .max(4_194_304, "Höchstens 4 TB."),

    totalCpuCores: z.coerce
      .number()
      .min(1, "Mindestens 1 Kern.")
      .max(512, "Höchstens 512 Kerne."),

    totalDiskMb: z.coerce
      .number()
      .int("Ganze Zahl.")
      .min(10_240, "Mindestens 10 GB.")
      .max(1_073_741_824, "Höchstens 1 PB."),

    reservedMemoryMb: z.coerce
      .number()
      .int("Ganze Zahl.")
      .min(0, "Nicht negativ.")
      .max(4_194_304, "Unrealistisch hoch."),

    reservedDiskMb: z.coerce
      .number()
      .int("Ganze Zahl.")
      .min(0, "Nicht negativ.")
      .max(1_073_741_824, "Unrealistisch hoch."),

    cpuOvercommit: z.coerce
      .number()
      .min(1, "Mindestens 1 — darunter würde Kapazität verschenkt.")
      .max(8, "Höchstens 8. Darüber stottern alle Server gleichzeitig."),

    status: z.enum(["ONLINE", "DRAINING", "OFFLINE"]),
  })
  // Die Reserve muss kleiner sein als das Ganze, sonst ist die Kapazität
  // null und kein Server ließe sich mehr anlegen — mit einer Fehlermeldung,
  // die auf den Tarif zeigt statt auf den Node.
  .refine((data) => data.reservedMemoryMb < data.totalMemoryMb, {
    path: ["reservedMemoryMb"],
    message: "Muss kleiner sein als der gesamte Arbeitsspeicher.",
  })
  .refine((data) => data.reservedDiskMb < data.totalDiskMb, {
    path: ["reservedDiskMb"],
    message: "Muss kleiner sein als der gesamte Speicherplatz.",
  });

export type NodeInput = z.infer<typeof nodeInput>;

export function nodeInputFromForm(formData: FormData) {
  return nodeInput.safeParse({
    name: formData.get("name") ?? "",
    agentUrl: formData.get("agentUrl") ?? "",
    agentToken: formData.get("agentToken") ?? "",
    publicHost: formData.get("publicHost") ?? "",
    totalMemoryMb: formData.get("totalMemoryMb") ?? "",
    totalCpuCores: formData.get("totalCpuCores") ?? "",
    totalDiskMb: formData.get("totalDiskMb") ?? "",
    reservedMemoryMb: formData.get("reservedMemoryMb") ?? "",
    reservedDiskMb: formData.get("reservedDiskMb") ?? "",
    cpuOvercommit: formData.get("cpuOvercommit") ?? "",
    status: formData.get("status") ?? "ONLINE",
  });
}

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
