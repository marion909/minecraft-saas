import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SERVER_NAME_MAX,
  SERVER_NAME_MIN,
  checkServerName,
} from "./server-name.ts";

describe("checkServerName", () => {
  it("nimmt gewöhnliche Namen an", () => {
    const result = checkServerName("Survival mit Freunden");
    assert.equal(result.ok, true);
    assert.equal(result.value, "Survival mit Freunden");
  });

  it("lässt Umlaute und Ziffern zu", () => {
    // Anders als die Adresse geht der Name nicht ins DNS.
    assert.equal(checkServerName("Bärenhöhle 2").ok, true);
  });

  it("schneidet außen ab", () => {
    const result = checkServerName("   Survival   ");
    assert.equal(result.ok, true);
    assert.equal(result.value, "Survival");
  });

  it("zieht innere Leerzeichen zusammen", () => {
    // Sonst stünden „Mein   Server“ und „Mein Server“ nebeneinander und
    // sähen in der Liste gleich aus.
    const result = checkServerName("Mein   Server");
    assert.equal(result.ok, true);
    assert.equal(result.value, "Mein Server");
  });

  it("weist zu kurze Namen ab", () => {
    const result = checkServerName("x");
    assert.equal(result.ok, false);
    assert.match(result.reason, new RegExp(String(SERVER_NAME_MIN)));
  });

  it("weist einen Namen aus lauter Leerzeichen ab", () => {
    assert.equal(checkServerName("      ").ok, false);
  });

  it("nimmt einen Namen genau an der Obergrenze an", () => {
    assert.equal(checkServerName("x".repeat(SERVER_NAME_MAX)).ok, true);
  });

  it("weist einen Namen darüber ab", () => {
    assert.equal(checkServerName("x".repeat(SERVER_NAME_MAX + 1)).ok, false);
  });

  it("misst nach dem Trimmen, nicht davor", () => {
    const padded = `  ${"x".repeat(SERVER_NAME_MAX)}  `;
    assert.equal(checkServerName(padded).ok, true);
  });

  it("weist unsichtbare Steuerzeichen ab", () => {
    // Kommt beim Kopieren aus anderen Programmen herein. Zwei Server
    // sähen dann in der Liste identisch benannt aus.
    assert.equal(checkServerName("Survival​").ok, false);
    assert.equal(checkServerName("Survival").ok, false);
  });
});
