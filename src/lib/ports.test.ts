import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GAMES, findGame, gameOrThrow, type Game } from "./games.ts";
import { allocatePort, blockSize, portMappings, portsOf } from "./ports.ts";

const BEREICH = { start: 27000, end: 27009 };

describe("blockSize", () => {
  it("gibt einem Spiel ohne Zusatzports genau einen", () => {
    assert.equal(blockSize(gameOrThrow("terraria")), 1);
  });

  it("zählt Zusatzports mit", () => {
    // Valheim braucht Spiel- und Abfrageport nebeneinander.
    assert.equal(blockSize(gameOrThrow("valheim")), 2);
  });
});

describe("allocatePort", () => {
  it("gibt den ersten Port des leeren Bereichs", () => {
    const ergebnis = allocatePort([], BEREICH, 1);
    assert.equal(ergebnis.ok, true);
    assert.equal(ergebnis.ok && ergebnis.port, 27000);
  });

  it("überspringt vergebene Ports", () => {
    const ergebnis = allocatePort([27000, 27001], BEREICH, 1);
    assert.equal(ergebnis.ok && ergebnis.port, 27002);
  });

  it("füllt Lücken, statt nach oben davonzulaufen", () => {
    // Nach dem Löschen des mittleren Servers soll seine Nummer wieder
    // verwendet werden.
    const ergebnis = allocatePort([27000, 27002, 27003], BEREICH, 1);
    assert.equal(ergebnis.ok && ergebnis.port, 27001);
  });

  it("verlangt einen zusammenhängenden Block", () => {
    // 27001 ist frei, aber 27002 nicht — ein Zweierblock passt erst ab
    // 27003.
    const ergebnis = allocatePort([27000, 27002], BEREICH, 2);
    assert.equal(ergebnis.ok && ergebnis.port, 27003);
  });

  it("nutzt den Bereich bis zum letzten Port aus", () => {
    const voll = Array.from({ length: 9 }, (_, i) => 27000 + i);
    const ergebnis = allocatePort(voll, BEREICH, 1);
    assert.equal(ergebnis.ok && ergebnis.port, 27009);
  });

  it("lehnt ab, wenn der Block über das Ende hinausragen würde", () => {
    // 27009 ist frei, aber ein Zweierblock bräuchte 27010 — außerhalb.
    const fast = Array.from({ length: 9 }, (_, i) => 27000 + i);
    const ergebnis = allocatePort(fast, BEREICH, 2);
    assert.equal(ergebnis.ok, false);
    assert.match(ergebnis.ok === false ? ergebnis.reason : "", /kein Block/);
  });

  it("meldet einen vollen Bereich verständlich", () => {
    const voll = Array.from({ length: 10 }, (_, i) => 27000 + i);
    const ergebnis = allocatePort(voll, BEREICH, 1);
    assert.equal(ergebnis.ok, false);
    assert.match(ergebnis.ok === false ? ergebnis.reason : "", /27000–27009/);
  });

  it("weist einen verkehrt herum eingetragenen Bereich ab", () => {
    const ergebnis = allocatePort([], { start: 27100, end: 27000 }, 1);
    assert.equal(ergebnis.ok, false);
    assert.match(ergebnis.ok === false ? ergebnis.reason : "", /verkehrt herum/);
  });

  it("gibt alle belegten Ports des Blocks zurück", () => {
    const ergebnis = allocatePort([], BEREICH, 3);
    assert.deepEqual(ergebnis.ok && ergebnis.belegt, [27000, 27001, 27002]);
  });

  it("vergibt nie zweimal denselben Port", () => {
    // Der Fall, der wehtut: Zwei Server auf demselben Port heißt, dass
    // der zweite nicht startet und fremde Spieler beim ersten landen.
    const vergeben: number[] = [];
    const gesehen = new Set<number>();

    for (let i = 0; i < 5; i += 1) {
      const ergebnis = allocatePort(vergeben, BEREICH, 2);
      assert.equal(ergebnis.ok, true, `Durchgang ${i}`);
      if (!ergebnis.ok) break;

      for (const port of ergebnis.belegt) {
        assert.ok(!gesehen.has(port), `Port ${port} doppelt vergeben`);
        gesehen.add(port);
        vergeben.push(port);
      }
    }

    assert.equal(gesehen.size, 10);
  });
});

describe("portMappings", () => {
  it("legt Minecraft auf seinen gewohnten Port", () => {
    const [erstes] = portMappings(gameOrThrow("minecraft"), 25565);
    assert.deepEqual(erstes, {
      containerPort: 25565,
      hostPort: 25565,
      transport: "tcp",
    });
  });

  it("behält im Container die Spielnummer und legt außen den Block", () => {
    // Valheim lässt sich innen nicht umkonfigurieren; nach außen muss es
    // trotzdem auf dem zugeteilten Block liegen.
    const mappings = portMappings(gameOrThrow("valheim"), 27004);

    assert.deepEqual(mappings, [
      { containerPort: 2456, hostPort: 27004, transport: "udp" },
      { containerPort: 2457, hostPort: 27005, transport: "udp" },
    ]);
  });

  it("bildet gemischte Protokolle richtig ab", () => {
    // Rust spielt über UDP, seine Fernsteuerung läuft über TCP.
    const mappings = portMappings(gameOrThrow("rust"), 27000);
    assert.equal(mappings[0]?.transport, "udp");
    assert.equal(mappings[1]?.transport, "tcp");
    assert.equal(mappings[1]?.hostPort, 27001);
  });

  it("erzeugt bei „beide“ zwei Einträge für dieselbe Nummer", () => {
    const zwitter: Game = {
      ...gameOrThrow("terraria"),
      transport: "beide",
    };

    const mappings = portMappings(zwitter, 27000);
    assert.equal(mappings.length, 2);
    assert.deepEqual(
      mappings.map((m) => m.transport).sort(),
      ["tcp", "udp"],
    );
  });

  it("deckt sich mit portsOf", () => {
    for (const spiel of ["minecraft", "valheim", "rust", "7dtd", "cs2"]) {
      const game = gameOrThrow(spiel);
      const belegt = portsOf(game, 27000);
      const ausMapping = [...new Set(portMappings(game, 27000).map((m) => m.hostPort))];

      assert.deepEqual(
        ausMapping.sort(),
        belegt.sort(),
        `${spiel}: Mapping und Belegung müssen dieselben Ports nennen`,
      );
    }
  });
});

describe("Katalog", () => {
  it("kennt kein Spiel doppelt", () => {
    assert.equal(new Set(GAMES.map((g) => g.id)).size, GAMES.length);
  });

  it("gibt für Unbekanntes nichts zurück", () => {
    assert.equal(findGame("halflife3"), undefined);
    assert.throws(() => gameOrThrow("halflife3"), /Unbekanntes Spiel/);
  });
});

describe("Portabbildung über den ganzen Katalog", () => {
  it("gibt derselben Containernummer nie zwei Außenports", () => {
    // Genau das war bei 7 Days to Die der Fall: 26900 stand einmal als
    // gamePort (udp) und einmal als extraPort (tcp), und die Zuteilung
    // legte sie auf zwei verschiedene Außenports. Ein Client verbindet
    // sich aber zu einer Adresse mit einer Nummer.
    for (const game of GAMES) {
      if (game.routing !== "port") continue;

      const proNummer = new Map<number, Set<number>>();

      for (const m of portMappings(game, 27000)) {
        const bisher = proNummer.get(m.containerPort) ?? new Set<number>();
        bisher.add(m.hostPort);
        proNummer.set(m.containerPort, bisher);
      }

      for (const [containerPort, hostPorts] of proNummer) {
        assert.equal(
          hostPorts.size,
          1,
          `${game.id}: ${containerPort} liegt außen auf ${[...hostPorts].join(" und ")}`,
        );
      }
    }
  });

  it("belegt nie mehr Außenports, als der Block groß ist", () => {
    for (const game of GAMES) {
      if (game.routing !== "port") continue;

      const außen = new Set(portMappings(game, 27000).map((m) => m.hostPort));
      assert.ok(
        außen.size <= blockSize(game),
        `${game.id}: ${außen.size} Außenports bei Blockgröße ${blockSize(game)}`,
      );
    }
  });

  it("hält Satisfactory auf einer Nummer für Spiel und API", () => {
    // Die Server-API läuft über TCP auf derselben 7777 wie das Spiel über
    // UDP. Ohne TCP kann der Client den Server nicht einmal hinzufügen.
    const sf = gameOrThrow("satisfactory");
    const m = portMappings(sf, 27000);

    assert.deepEqual(
      m.map((x) => `${x.containerPort}/${x.transport}→${x.hostPort}`).sort(),
      ["7777/tcp→27000", "7777/udp→27000"],
    );
  });
});
