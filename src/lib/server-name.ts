/**
 * Regeln für den Anzeigenamen eines Servers.
 *
 * Getrennt von der Subdomain, weil beide verschiedene Dinge sind: Die
 * Adresse geht ins DNS und in Docker-Labels, der Name steht nur im Panel.
 * Deshalb darf er Leerzeichen und Umlaute enthalten — eindeutig muss er
 * trotzdem sein, aber nur je Nutzer: Zwei Leute dürfen ihren Server beide
 * „Survival“ nennen, eine Person nicht zweimal.
 */

export const SERVER_NAME_MIN = 2;
export const SERVER_NAME_MAX = 40;

export type NameCheck =
  | { ok: true; value: string }
  | { ok: false; reason: string };

export function checkServerName(input: string): NameCheck {
  // Innenliegende Folgen von Leerzeichen zusammenziehen: „Mein   Server“
  // und „Mein Server“ sind für das Auge dasselbe und sollen nicht als
  // zwei verschiedene Namen nebeneinander stehen.
  const value = input.trim().replace(/\s+/g, " ");

  if (value.length < SERVER_NAME_MIN) {
    return { ok: false, reason: `Mindestens ${SERVER_NAME_MIN} Zeichen.` };
  }
  if (value.length > SERVER_NAME_MAX) {
    return { ok: false, reason: `Höchstens ${SERVER_NAME_MAX} Zeichen.` };
  }

  // Steuerzeichen kämen über Kopieren aus anderen Programmen herein und
  // wären in der Liste unsichtbar — zwei Server sähen gleich benannt aus.
  if (/[\p{Cc}\p{Cf}]/u.test(value)) {
    return { ok: false, reason: "Enthält unsichtbare Steuerzeichen." };
  }

  return { ok: true, value };
}
