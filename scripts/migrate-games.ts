/**
 * Bereitet bestehende Nodes auf mehrere Spiele vor.
 *
 *   node scripts/migrate-games.ts          # zeigt nur, was es täte
 *   node scripts/migrate-games.ts --tun    # schreibt
 *
 * Bis hierher war `publicHost` der vollständige Wildcard-Name für
 * Minecraft, meist "mc.example.com". Seit es mehrere Spiele gibt, setzt
 * sich die Adresse aus Spielsegment und Basis zusammen. Damit die
 * bestehenden Minecraft-Adressen unverändert bleiben, muss die Basis
 * genau der Teil hinter "mc." sein.
 */
import { createClient } from "../prisma/client.ts";
import { GAMES } from "../src/lib/games.ts";

const db = createClient();
const schreiben = process.argv.includes("--tun");

async function main() {
  const nodes = await db.node.findMany();

  if (nodes.length === 0) {
    console.info("Kein Node eingetragen — nichts zu tun.");
    return;
  }

  for (const node of nodes) {
    console.info(`\n── ${node.name}`);
    console.info(`   publicHost bisher: ${node.publicHost}`);

    if (node.baseDomain) {
      console.info(`   baseDomain steht schon auf "${node.baseDomain}" — übersprungen.`);
      continue;
    }

    // "mc." abschneiden hält die Adressen gleich: Aus mc.example.com
    // wird example.com, und der Katalog setzt "mc" wieder davor.
    const basis = node.publicHost.startsWith("mc.")
      ? node.publicHost.slice(3)
      : node.publicHost;

    const server = await db.server.findMany({
      where: { nodeId: node.id },
      select: { subdomain: true },
    });

    if (!node.publicHost.startsWith("mc.")) {
      console.warn(
        `   ACHTUNG: "${node.publicHost}" beginnt nicht mit "mc.". Als Basis\n` +
          `   wird der ganze Name genommen — die Minecraft-Adressen ändern sich\n` +
          `   dadurch von <name>.${node.publicHost}\n` +
          `   zu           <name>.mc.${basis}\n` +
          `   Wenn das nicht gewollt ist: baseDomain von Hand setzen.`,
      );
    }

    console.info(`   baseDomain wird: ${basis}`);

    for (const eintrag of server) {
      console.info(`   ${eintrag.subdomain}: ${eintrag.subdomain}.mc.${basis}`);
    }

    if (schreiben) {
      await db.node.update({
        where: { id: node.id },
        data: { baseDomain: basis },
      });
    }

    console.info("\n   Nötige DNS-Einträge (A auf die IP dieses Hosts):");
    for (const game of GAMES) {
      console.info(`     *.${game.slug}.${basis}${game.id === "minecraft" ? "   (steht schon)" : ""}`);
    }
    console.info(
      `\n   Und im Router weiterleiten: ${node.portRangeStart}–${node.portRangeEnd} ` +
        `(TCP und UDP) für alles außer Minecraft.`,
    );
  }

  const ohneSpiel = await db.server.count({ where: { game: "" } });
  if (ohneSpiel > 0 && schreiben) {
    await db.server.updateMany({ where: { game: "" }, data: { game: "minecraft" } });
    console.info(`\n${ohneSpiel} Server auf "minecraft" gesetzt.`);
  }

  console.info(
    schreiben
      ? "\nGeschrieben."
      : "\nNichts geschrieben. Mit --tun ausführen, wenn es so passt.",
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
