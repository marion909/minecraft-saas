import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareVersions,
  imageForVersion,
  isDowngrade,
  javaForVersion,
  NEWEST_JAVA,
  parseVersion,
} from "./java.ts";

describe("parseVersion", () => {
  it("erkennt das alte 1.x-Schema", () => {
    assert.deepEqual(parseVersion("1.21.8"), { kind: "legacy", minor: 21, patch: 8 });
    assert.deepEqual(parseVersion("1.16.5"), { kind: "legacy", minor: 16, patch: 5 });
  });

  it("erkennt das neue Schema ab 2026", () => {
    assert.deepEqual(parseVersion("26.1"), { kind: "modern", major: 26, minor: 1 });
  });

  it("gibt bei Platzhaltern auf, statt zu raten", () => {
    for (const version of ["LATEST", "SNAPSHOT", "", "irgendwas"]) {
      assert.deepEqual(parseVersion(version), { kind: "unknown" });
    }
  });
});

describe("javaForVersion", () => {
  it("ordnet alte Versionen dem alten Java zu", () => {
    assert.equal(javaForVersion("1.12.2"), 8);
    assert.equal(javaForVersion("1.16.5"), 8);
  });

  it("kennt den Sprung auf Java 17 ab 1.17", () => {
    assert.equal(javaForVersion("1.17"), 17);
    assert.equal(javaForVersion("1.20.4"), 17);
  });

  it("kennt den Sprung auf Java 21 ab 1.21", () => {
    assert.equal(javaForVersion("1.21.8"), 21);
  });

  it("gibt dem neuen Versionsschema das neueste Java", () => {
    assert.equal(javaForVersion("26.1"), NEWEST_JAVA);
  });

  it("wählt für LATEST das neueste Java", () => {
    // Bei LATEST steht die Version erst beim Start fest. Zu altes Java
    // lässt den Server gar nicht hochkommen — genau dieser Fall hat den
    // ersten Testserver in eine Neustartschleife geschickt.
    assert.equal(javaForVersion("LATEST"), NEWEST_JAVA);
  });
});

describe("imageForVersion", () => {
  it("baut den vollständigen Image-Namen", () => {
    assert.equal(imageForVersion("1.21.8"), "itzg/minecraft-server:java21");
    assert.equal(imageForVersion("LATEST"), `itzg/minecraft-server:java${NEWEST_JAVA}`);
  });
});

describe("parseVersion mit Patch-Stelle", () => {
  it("liest die dritte Zahl im alten Schema", () => {
    assert.deepEqual(parseVersion("1.20.4"), {
      kind: "legacy",
      minor: 20,
      patch: 4,
    });
  });

  it("nimmt 0 an, wenn die Patch-Stelle fehlt", () => {
    assert.deepEqual(parseVersion("1.21"), {
      kind: "legacy",
      minor: 21,
      patch: 0,
    });
  });

  it("liest das neue Schema mit Nebenversion", () => {
    assert.deepEqual(parseVersion("26.2"), {
      kind: "modern",
      major: 26,
      minor: 2,
    });
  });
});

describe("compareVersions", () => {
  it("ordnet innerhalb des alten Schemas", () => {
    assert.ok(compareVersions("1.21.8", "1.20.4")! > 0);
    assert.ok(compareVersions("1.20.1", "1.20.4")! < 0);
    assert.equal(compareVersions("1.21.8", "1.21.8"), 0);
  });

  it("erkennt die Patch-Stelle als Unterschied", () => {
    assert.ok(compareVersions("1.21.8", "1.21.1")! > 0);
  });

  it("hält das neue Schema für neuer als das alte", () => {
    assert.ok(compareVersions("26.1", "1.21.8")! > 0);
    assert.ok(compareVersions("1.21.8", "26.1")! < 0);
  });

  it("ordnet innerhalb des neuen Schemas", () => {
    assert.ok(compareVersions("26.2", "26.1")! > 0);
    assert.ok(compareVersions("27.0", "26.9")! > 0);
  });

  it("gibt null zurück, wenn eine Seite ein Platzhalter ist", () => {
    assert.equal(compareVersions("LATEST", "1.21.8"), null);
    assert.equal(compareVersions("1.21.8", "SNAPSHOT"), null);
  });
});

describe("isDowngrade", () => {
  it("erkennt eine Rückstufung", () => {
    assert.equal(isDowngrade("1.21.8", "1.20.4"), true);
    assert.equal(isDowngrade("26.1", "1.21.8"), true);
  });

  it("erkennt eine Aufstufung und den Gleichstand", () => {
    assert.equal(isDowngrade("1.20.4", "1.21.8"), false);
    assert.equal(isDowngrade("1.21.8", "1.21.8"), false);
  });

  it("gibt null zurück, wenn es sich nicht feststellen lässt", () => {
    // Bei LATEST muss die Warnung vorsichtshalber erscheinen — die
    // tatsächliche Version steht erst beim Start fest.
    assert.equal(isDowngrade("LATEST", "1.20.4"), null);
  });
});
