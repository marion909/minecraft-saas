/**
 * Macht ein bestehendes Konto zum Admin.
 *
 *   node scripts/promote-admin.ts du@example.com
 *
 * Absichtlich ein CLI-Schritt und kein UI-Flow: Der erste Admin muss von
 * jemandem mit Shell-Zugang gesetzt werden, sonst wäre die Rolle über das
 * Panel selbst erreichbar.
 *
 * Läuft ohne pnpm und ohne tsx, direkt über Node — wie der Agent. Deshalb
 * endet der Import auf .ts und nicht auf .js: Node löst den Bezeichner
 * wörtlich auf, eine client.js gibt es nicht.
 */
import { createClient } from "../prisma/client.ts";

const db = createClient();

async function main() {
  const email = process.argv[2];

  if (!email) {
    console.error("Aufruf: node scripts/promote-admin.ts <e-mail>");
    process.exitCode = 1;
    return;
  }

  const user = await db.user.findUnique({ where: { email } });

  if (!user) {
    console.error(
      `Kein Konto mit der Adresse "${email}". Erst registrieren, dann hier erneut aufrufen.`,
    );
    process.exitCode = 1;
    return;
  }

  if (user.role === "admin") {
    console.info(`"${email}" ist bereits Admin.`);
    return;
  }

  await db.user.update({ where: { id: user.id }, data: { role: "admin" } });
  await db.auditLog.create({
    data: {
      userId: user.id,
      action: "user.role.promoted",
      meta: { from: user.role, to: "admin", via: "cli" },
    },
  });

  console.info(`"${email}" ist jetzt Admin.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
