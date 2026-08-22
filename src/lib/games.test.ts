import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ServerType } from "../generated/prisma/enums.ts";

import { GAMES, DEFAULT_GAME, findGame, serverAddress } from "./games.ts";

const SERVER_TYPES = new Set<string>(Object.values(ServerType));

describe("Katalog", () => {
  it("hat eindeutige Kennungen und Segmente", () => {
    assert.equal(new Set(GAMES.map((g) => g.id)).size, GAMES.length);
    assert.equal(new Set(GAMES.map((g) => g.slug)).size, GAMES.length);
  });

  it("kennt das Standardspiel", () => {
    assert.ok(findGame(DEFAULT_GAME));
  });

  it("nutzt als Segment nur, was im DNS erlaubt ist", () => {
    // Wird zu <server>.<slug>.<basis>. Ein Punkt oder Großbuchstabe hier
    // ergäbe einen Wildcard, den niemand anlegen kann.
    for (const game of GAMES) {
      assert.match(game.slug, /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, game.id);
    }
  });
});

describe("Varianten", () => {
  // Ein Tippfehler hier fällt sonst erst beim Anlegen auf, und zwar als
  // geworfener Fehler ohne Meldung: Prisma lehnt einen unbekannten
  // Enum-Wert ab, bevor es die Datenbank überhaupt sieht.
  it("nennt nur Werte, die die Datenbank kennt", () => {
    for (const game of GAMES) {
      for (const variante of game.variants ?? []) {
        assert.ok(
          SERVER_TYPES.has(variante.id),
          `${game.id}: „${variante.id}“ ist kein ServerType`,
        );
      }
    }
  });

  it("gibt es nur bei Minecraft", () => {
    // Nicht kosmetisch: Spiele ohne Varianten zeigen das Feld nicht an,
    // und beide Server-Actions müssen dann selbst einen gültigen Wert
    // einsetzen, statt den leeren aus dem Formular zu nehmen.
    const mitVarianten = GAMES.filter((g) => g.variants).map((g) => g.id);
    assert.deepEqual(mitVarianten, ["minecraft"]);
  });

  it("hat einen gültigen Ersatzwert für alle anderen", () => {
    // Den setzt createServer ein, wo das Formular nichts schickt.
    assert.ok(SERVER_TYPES.has(ServerType.PAPER));
  });
});

describe("serverAddress", () => {
  it("lässt Minecraft ohne Port", () => {
    const mc = findGame("minecraft")!;
    assert.equal(serverAddress(mc, "welt", "example.com", null), "welt.mc.example.com");
  });

  it("hängt bei den anderen den Port an", () => {
    const cs2 = findGame("cs2")!;
    assert.equal(
      serverAddress(cs2, "mixe", "example.com", 27004),
      "mixe.cs2.example.com:27004",
    );
  });
});
