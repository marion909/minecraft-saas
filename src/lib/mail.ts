import { env } from "./env";

export type Mail = {
  to: string;
  subject: string;
  text: string;
};

/**
 * In der Entwicklung landen Mails im Terminal. Das reicht, um den
 * Verifizierungs-Flow vollständig durchzuspielen, ohne einen Anbieter
 * anzubinden — der kommt vor dem ersten echten Nutzer dazu.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (env.MAIL_TRANSPORT === "console") {
    console.info(
      [
        "",
        "┌─ Mail (Transport: console) ────────────────────────────────",
        `│ An:      ${mail.to}`,
        `│ Von:     ${env.MAIL_FROM}`,
        `│ Betreff: ${mail.subject}`,
        "├────────────────────────────────────────────────────────────",
        ...mail.text.split("\n").map((line) => `│ ${line}`),
        "└────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return;
  }

  throw new Error(
    `MAIL_TRANSPORT="${env.MAIL_TRANSPORT}" ist noch nicht implementiert.`,
  );
}
