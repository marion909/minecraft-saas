/**
 * Legt den Node und die Standard-Tarife an. Idempotent — mehrfaches Ausführen
 * aktualisiert die Werte, statt Duplikate zu erzeugen.
 *
 * Die Vorgabewerte beschreiben die Zielhardware:
 *   Intel i5-12500 (6 Kerne / 12 Threads), 48 GB RAM,
 *   256 GB SSD (System + Docker), 1 TB SSD (ZFS-Pool "tank").
 *
 * Überschreiben geht über die NODE_*-Variablen in der .env.
 */
import { createClient } from "./client.ts";

const db = createClient();

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name}="${raw}" ist keine positive Zahl.`);
  }
  return parsed;
}

async function main() {
  const usingDefaults = process.env.NODE_TOTAL_MEMORY_MB === undefined;

  const nodeValues = {
    agentUrl: process.env.AGENT_URL ?? "http://127.0.0.1:8787",
    agentToken: process.env.AGENT_TOKEN ?? "dev-token-bitte-ersetzen",
    publicHost: process.env.NODE_PUBLIC_HOST ?? "mc.localhost",
    // Basis ohne Spielsegment — das setzt der Katalog davor.
    baseDomain:
      process.env.NODE_BASE_DOMAIN ??
      (process.env.NODE_PUBLIC_HOST ?? "mc.localhost").replace(/^mc\./, ""),
    portRangeStart: num("NODE_PORT_RANGE_START", 27_000),
    portRangeEnd: num("NODE_PORT_RANGE_END", 27_099),
    totalMemoryMb: num("NODE_TOTAL_MEMORY_MB", 49_152),
    totalCpuCores: num("NODE_TOTAL_CPU_CORES", 12),
    totalDiskMb: num("NODE_TOTAL_DISK_MB", 953_000),
    // OS + ZFS-ARC + Postgres + Redis + App + Agent
    reservedMemoryMb: num("NODE_RESERVED_MEMORY_MB", 12_288),
    reservedDiskMb: num("NODE_RESERVED_DISK_MB", 190_000),
    // 12 Threads bei Faktor 1,5 ergeben 18 zuteilbare Kerne — passend zu
    // den 9 Servern, die der Arbeitsspeicher zulässt.
    cpuOvercommit: 1.5,
  };

  // Bewusst auch im update-Zweig: der dokumentierte Ablauf ist, den Seed mit
  // korrigierten NODE_*-Werten erneut auszuführen. Ein leeres update würde
  // dabei stillschweigend die alten Zahlen behalten.
  const node = await db.node.upsert({
    where: { name: "local" },
    update: nodeValues,
    create: { name: "local", ...nodeValues },
  });

  const plans = [
    {
      slug: "starter",
      name: "Starter",
      memoryMb: 2048,
      cpuCores: 1,
      diskMb: 10_000,
      maxPlayers: 10,
      maxBackups: 3,
      maxServers: 1,
      priceCents: 0,
      isPublic: true,
    },
    {
      slug: "basic",
      name: "Basic",
      memoryMb: 4096,
      cpuCores: 2,
      diskMb: 25_000,
      maxPlayers: 20,
      maxBackups: 7,
      maxServers: 2,
      priceCents: 499,
      isPublic: true,
    },
    {
      slug: "modded",
      name: "Modded",
      memoryMb: 8192,
      cpuCores: 3,
      diskMb: 50_000,
      maxPlayers: 40,
      maxBackups: 14,
      maxServers: 3,
      priceCents: 999,
      isPublic: true,
    },
  ];

  for (const plan of plans) {
    await db.plan.upsert({
      where: { slug: plan.slug },
      update: plan,
      create: plan,
    });
  }

  console.info(`Node "${node.name}" und ${plans.length} Tarife sind angelegt.`);

  if (usingDefaults) {
    console.warn(
      [
        "",
        "⚠  Der Node wurde mit Platzhalter-Werten angelegt (32 GB RAM, 8 Kerne).",
        "   Sobald die echten Eckdaten feststehen, mit gesetzten",
        "   NODE_*-Variablen erneut ausführen — sonst verspricht die",
        "   Kapazitätsprüfung Ressourcen, die es nicht gibt.",
        "",
      ].join("\n"),
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
