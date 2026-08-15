import { z } from "zod";

// Mit Endung, weil dieses Modul auch unter `node --test` geladen wird und
// Node den Bezeichner wörtlich auflöst. Siehe server-status-map.ts.
import { ROLES } from "./roles.ts";

/**
 * Muss zu `emailAndPassword.minPasswordLength` in auth.ts passen. Läuft es
 * auseinander, nimmt das Formular ein Passwort an, das better-auth danach
 * ablehnt — und der Fehler kommt dann ohne Bezug zum Feld zurück.
 */
export const USER_MIN_PASSWORD_LENGTH = 10;

export const userInput = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Mindestens 2 Zeichen.")
    .max(60, "Höchstens 60 Zeichen."),

  // Erst trimmen und kleinschreiben, dann prüfen: better-auth legt die
  // Adresse ebenfalls kleingeschrieben ab, und sonst gäbe es zwei Konten,
  // die sich nur in der Groß-/Kleinschreibung unterscheiden.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Das sieht nicht nach einer E-Mail-Adresse aus.")),

  password: z
    .string()
    .min(
      USER_MIN_PASSWORD_LENGTH,
      `Mindestens ${USER_MIN_PASSWORD_LENGTH} Zeichen.`,
    )
    .max(128, "Höchstens 128 Zeichen."),

  role: z.enum([ROLES.USER, ROLES.ADMIN], {
    message: "Unbekannte Rolle.",
  }),
});

export type UserInput = z.infer<typeof userInput>;

export function userInputFromForm(formData: FormData) {
  return userInput.safeParse({
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    password: formData.get("password") ?? "",
    role: formData.get("role") ?? ROLES.USER,
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
