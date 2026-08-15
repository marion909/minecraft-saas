import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseMeminfo } from "./host.ts";

/**
 * Die Vorlage ist echte Ausgabe aus einem Linux-Container, nicht aus dem
 * Kopf geschrieben. Ein Parser gegen ein erfundenes Format bestätigt nur
 * die eigene Annahme.
 */
const REAL_MEMINFO = `MemTotal:       16355308 kB
MemFree:        11120088 kB
MemAvailable:   14077068 kB
Buffers:           57544 kB
Cached:          3017120 kB
SwapCached:            0 kB
Active:          2265916 kB
Inactive:        2596404 kB
`;

describe("parseMeminfo", () => {
  it("liest MemTotal und MemAvailable", () => {
    assert.deepEqual(parseMeminfo(REAL_MEMINFO), {
      totalKb: 16_355_308,
      availableKb: 14_077_068,
    });
  });

  it("nimmt MemAvailable, nicht MemFree", () => {
    // Der Unterschied ist der Punkt der Funktion: MemFree wäre hier
    // 11 GB, MemAvailable 14 GB — auf einem eingelaufenen Server liegen
    // dazwischen leicht 20 GB Seitencache.
    const parsed = parseMeminfo(REAL_MEMINFO);
    assert.notEqual(parsed?.availableKb, 11_120_088);
  });

  it("gibt null zurück, wenn MemAvailable fehlt", () => {
    // Kernel vor 3.14 kennen das Feld nicht. Dann lieber der Rückfall auf
    // node:os als eine aus MemFree geratene Zahl.
    const alt = REAL_MEMINFO.split("\n")
      .filter((line) => !line.startsWith("MemAvailable"))
      .join("\n");

    assert.equal(parseMeminfo(alt), null);
  });

  it("gibt null zurück bei leerer oder fremder Eingabe", () => {
    assert.equal(parseMeminfo(""), null);
    assert.equal(parseMeminfo("Speicher: viel\n"), null);
  });

  it("lässt sich nicht von ähnlich benannten Feldern täuschen", () => {
    // "SwapTotal" enthält "Total", "MemTotal" darf davon nicht kommen.
    const swapOnly = "SwapTotal:       2097148 kB\nSwapFree:        2097148 kB\n";
    assert.equal(parseMeminfo(swapOnly), null);
  });

  it("verlangt die Einheit", () => {
    // Ohne "kB" stimmt die Größenordnung nicht mehr, und eine Zahl in der
    // falschen Einheit ist schlimmer als keine.
    assert.equal(
      parseMeminfo("MemTotal:       16355308\nMemAvailable:   14077068\n"),
      null,
    );
  });
});
