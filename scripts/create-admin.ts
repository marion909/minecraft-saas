/**
 * Legt das erste Konto an — das einzige, das nicht über das Panel entstehen
 * kann.
 *
 *   node scripts/create-admin.ts du@example.com "Dein Name"
 *
 * Seit die Selbstregistrierung abgeschaltet ist (`disableSignUp` in
 * src/lib/auth.ts), legt nur ein Admin Konten an. Für den allerersten gibt
 * es dann niemanden — deshalb dieser Weg über die Shell, genau wie bei
 * promote-admin.ts.
 *
 * Das Passwort wird erzeugt und einmal ausgegeben. Es wird nirgends sonst
 * hingeschrieben; wer es verliert, legt ein neues Konto an.
 */
import { randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";

import { createClient } from "../prisma/client.ts";
import { ROLES } from "../src/lib/roles.ts";
import { checkServerName } from "../src/lib/server-name.ts";

const db = createClient();

/** Ohne l, I, O, 0 und 1 — das Passwort wird abgetippt oder vorgelesen. */
function generatePassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join(
    "",
  );
}

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  const name = (process.argv[3] ?? "Admin").trim();

  if (!email || !email.includes("@")) {
    console.error(
      'Aufruf: node scripts/create-admin.ts <e-mail> ["Name"]',
    );
    process.exitCode = 1;
    return;
  }

  const parsedName = checkServerName(name);
  if (!parsedName.ok) {
    console.error(`Name ungültig: ${parsedName.reason}`);
    process.exitCode = 1;
    return;
  }

  const existing = await db.user.findUnique({ where: { email } });

  if (existing) {
    console.error(
      `"${email}" gibt es schon. Zum Hochstufen: node scripts/promote-admin.ts ${email}`,
    );
    process.exitCode = 1;
    return;
  }

  const password = process.env.ADMIN_PASSWORD || generatePassword();
  const userId = randomUUID();

  await db.user.create({
    data: {
      id: userId,
      name: parsedName.value,
      email,
      // Es gibt keine Mail, die jemand öffnen könnte, und ohne dieses Flag
      // käme das Konto wegen requireEmailVerification nicht am Login vorbei.
      emailVerified: true,
      role: ROLES.ADMIN,
    },
  });

  await db.account.create({
    data: {
      id: randomUUID(),
      userId,
      accountId: userId,
      providerId: "credential",
      password: await hashPassword(password),
    },
  });

  await db.auditLog.create({
    data: {
      userId,
      action: "user.created",
      meta: { email, role: ROLES.ADMIN, via: "cli" },
    },
  });

  console.info(`\nAdmin angelegt.\n`);
  console.info(`  E-Mail:   ${email}`);
  console.info(`  Passwort: ${password}\n`);
  console.info(
    process.env.ADMIN_PASSWORD
      ? "Passwort aus ADMIN_PASSWORD übernommen.\n"
      : "Notier es jetzt — es steht nirgendwo sonst.\n",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
