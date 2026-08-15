import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkSubdomain } from "./subdomain.ts";

describe("checkSubdomain", () => {
  it("nimmt gewöhnliche Namen an und normalisiert sie", () => {
    for (const [input, expected] of [
      ["meinserver", "meinserver"],
      ["  Creeper-Welt  ", "creeper-welt"],
      ["mc2026", "mc2026"],
    ] as const) {
      const result = checkSubdomain(input);
      assert.equal(result.ok, true, `"${input}" sollte gültig sein`);
      assert.equal(result.ok === true && result.value, expected);
    }
  });

  it("lehnt reservierte Namen ab", () => {
    for (const name of ["admin", "panel", "api", "www", "mc"]) {
      const result = checkSubdomain(name);
      assert.equal(result.ok, false, `"${name}" ist reserviert`);
    }
  });

  it("lehnt Namen ab, die im DNS oder im Routing Ärger machen", () => {
    for (const name of [
      "-vorne",
      "hinten-",
      "mit punkt.drin",
      "mit_unterstrich",
      "a",
      "ümlaut",
      "viel-zu-langer-name-der-die-grenze-deutlich-ueberschreitet",
    ]) {
      assert.equal(checkSubdomain(name).ok, false, `"${name}" sollte scheitern`);
    }
  });

  it("nennt bei jeder Ablehnung einen Grund", () => {
    const result = checkSubdomain("admin");
    assert.equal(result.ok, false);
    assert.ok(
      result.ok === false && result.reason.length > 5,
      "Die Meldung muss dem Nutzer sagen, was falsch ist",
    );
  });
});
