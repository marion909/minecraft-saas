import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertServerId,
  assertSubdomain,
  containerName,
  datasetName,
  snapshotLabel,
} from "./naming.ts";
import { decodePackets, encodePacket, PacketType } from "./rcon.ts";
import { buildContainerOptions, READY_PATTERN, type ServerSpec } from "./spec.ts";

const SPEC: ServerSpec = {
  serverId: "cmst9sik00002kos5j9ew2dh6",
  subdomain: "creeper",
  serverType: "PAPER",
  mcVersion: "1.21.8",
  memoryMb: 4096,
  cpuCores: 2,
  maxPlayers: 20,
  rconPassword: "geheim-und-lang-genug",
  dataPath: "/srv/mc/srv-cmst9sik00002kos5j9ew2dh6",
  hostname: "creeper.mc.neuhauser.app",
};

describe("naming", () => {
  it("nimmt eine gültige cuid an", () => {
    assert.equal(assertServerId(SPEC.serverId), SPEC.serverId);
  });

  it("lehnt IDs mit Sonderzeichen ab, die in Shell-Argumente geraten könnten", () => {
    for (const id of ["../../etc", "abc; rm -rf /", "kurz", "MIT-GROSS"]) {
      assert.throws(() => assertServerId(id), /Ungültige Server-ID/);
    }
  });

  it("lehnt reservierte Subdomains ab", () => {
    for (const name of ["admin", "panel", "api", "mc"]) {
      assert.throws(() => assertSubdomain(name), /reserviert/);
    }
  });

  it("lehnt Subdomains mit führendem Bindestrich ab", () => {
    assert.throws(() => assertSubdomain("-test"), /Ungültige Subdomain/);
  });

  it("leitet Container- und Dataset-Namen aus der ID ab", () => {
    assert.equal(containerName(SPEC.serverId), `mc-${SPEC.serverId}`);
    assert.equal(
      datasetName("tank/mc", SPEC.serverId),
      `tank/mc/srv-${SPEC.serverId}`,
    );
  });

  it("erzeugt sortierbare Snapshot-Namen ohne Doppelpunkte", () => {
    const label = snapshotLabel(new Date("2026-08-15T12:34:56.789Z"));
    assert.ok(!label.includes(":"), "Doppelpunkte brechen ZFS-Namen");
    assert.match(label, /^2026-08-15T12-34-56/);
  });
});

describe("buildContainerOptions", () => {
  const options = buildContainerOptions(SPEC);
  const env = Object.fromEntries(
    (options.Env ?? []).map((entry) => {
      const index = entry.indexOf("=");
      return [entry.slice(0, index), entry.slice(index + 1)];
    }),
  );

  it("hält den JVM-Heap unter dem Container-Limit", () => {
    assert.equal(env.MAX_MEMORY, "3328M");
    assert.equal(options.HostConfig?.Memory, 4096 * 1024 * 1024);
  });

  it("verbietet Swap, indem MemorySwap gleich Memory ist", () => {
    assert.equal(options.HostConfig?.MemorySwap, options.HostConfig?.Memory);
  });

  it("veröffentlicht keinen Spielport", () => {
    assert.equal(options.HostConfig?.PortBindings, undefined);
    assert.equal(options.ExposedPorts, undefined);
  });

  it("setzt die Härtungsoptionen", () => {
    assert.deepEqual(options.HostConfig?.SecurityOpt, [
      "no-new-privileges:true",
    ]);
    assert.deepEqual(options.HostConfig?.CapDrop, ["ALL"]);
    assert.equal(options.HostConfig?.PidsLimit, 512);
  });

  it("gibt genau die Rechte zurück, die der Nutzerwechsel im Image braucht", () => {
    // Ohne SETUID/SETGID scheitert der Wechsel auf UID 1000 und der
    // Container läuft in eine Neustartschleife.
    assert.deepEqual(options.HostConfig?.CapAdd, [
      "CHOWN",
      "DAC_OVERRIDE",
      "FOWNER",
      "SETGID",
      "SETUID",
    ]);
  });

  it("gibt NET_RAW nicht zurück — kein Paket-Spoofing aus dem Container", () => {
    assert.ok(!options.HostConfig?.CapAdd?.includes("NET_RAW"));
    assert.ok(!options.HostConfig?.CapAdd?.includes("SYS_ADMIN"));
  });

  it("gibt der Welt Zeit zum Speichern", () => {
    assert.equal(options.StopTimeout, 120);
  });

  it("beschriftet den Container für Abgleich und Routing", () => {
    assert.equal(options.Labels?.["saas.managed"], "true");
    assert.equal(options.Labels?.["saas.serverId"], SPEC.serverId);
    assert.equal(options.Labels?.["mc-router.host"], SPEC.hostname);
  });

  it("schreibt das RCON-Passwort nicht in die Server-Logs", () => {
    assert.equal(env.BROADCAST_RCON_TO_OPS, "false");
  });

  it("veröffentlicht RCON nur, wenn ausdrücklich verlangt", () => {
    const dev = buildContainerOptions({ ...SPEC, publishRcon: true });
    assert.deepEqual(dev.ExposedPorts, { "25575/tcp": {} });
    assert.equal(
      dev.HostConfig?.PortBindings?.["25575/tcp"]?.[0]?.HostIp,
      "127.0.0.1",
    );
  });

  it("lehnt Tarife ab, deren Speicher für eine JVM nicht reicht", () => {
    assert.throws(() => buildContainerOptions({ ...SPEC, memoryMb: 1024 }));
  });
});

describe("READY_PATTERN", () => {
  it("erkennt die Bereitschaftszeile von Paper und Vanilla", () => {
    assert.ok(
      READY_PATTERN.test(
        '[12:00:00] [Server thread/INFO]: Done (21.402s)! For help, type "help"',
      ),
    );
  });

  it("löst nicht schon beim Start aus", () => {
    assert.ok(
      !READY_PATTERN.test("[12:00:00] [Server thread/INFO]: Starting minecraft server"),
    );
  });
});

describe("RCON-Protokoll", () => {
  it("kodiert und dekodiert ein Paket verlustfrei", () => {
    const packet = { id: 42, type: PacketType.Command, body: "list" };
    const { packets } = decodePackets(encodePacket(packet));
    assert.deepEqual(packets, [packet]);
  });

  it("schreibt die Länge ohne das Längenfeld selbst", () => {
    const encoded = encodePacket({ id: 1, type: 2, body: "ab" });
    assert.equal(encoded.readInt32LE(0), encoded.length - 4);
  });

  it("liest mehrere Pakete aus einem Chunk", () => {
    const buffer = Buffer.concat([
      encodePacket({ id: 1, type: 0, body: "eins" }),
      encodePacket({ id: 2, type: 0, body: "zwei" }),
    ]);
    const { packets, rest } = decodePackets(buffer);
    assert.equal(packets.length, 2);
    assert.equal(rest.length, 0);
  });

  it("hält ein angeschnittenes Paket zurück, statt es zu verstümmeln", () => {
    const full = encodePacket({ id: 7, type: 0, body: "unvollständig" });
    const { packets, rest } = decodePackets(full.subarray(0, full.length - 4));

    assert.equal(packets.length, 0);
    assert.equal(rest.length, full.length - 4);

    // Kommt der Rest nach, ist das Paket vollständig lesbar.
    const complete = decodePackets(
      Buffer.concat([rest, full.subarray(full.length - 4)]),
    );
    assert.deepEqual(complete.packets, [{ id: 7, type: 0, body: "unvollständig" }]);
  });

  it("wehrt sich gegen unplausible Längenangaben", () => {
    const evil = Buffer.alloc(8);
    evil.writeInt32LE(1_000_000, 0);
    assert.throws(() => decodePackets(evil), /unplausible/);
  });

  it("verkraftet Umlaute im Body", () => {
    const packet = { id: 3, type: 0, body: "Spieler „Müller“ beigetreten" };
    const { packets } = decodePackets(encodePacket(packet));
    assert.deepEqual(packets, [packet]);
  });
});
