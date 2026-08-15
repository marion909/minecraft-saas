import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PLAN_MIN_MEMORY_MB,
  fieldErrors,
  planInputFromForm,
} from "./plan-schema.ts";

function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  const base: Record<string, string> = {
    name: "Basic",
    slug: "basic",
    memoryMb: "4096",
    cpuCores: "2",
    diskMb: "25000",
    maxPlayers: "20",
    maxBackups: "7",
    maxServers: "1",
    priceCents: "499",
    ...overrides,
  };

  for (const [key, value] of Object.entries(base)) {
    data.set(key, value);
  }
  return data;
}

describe("planInputFromForm", () => {
  it("nimmt einen gültigen Tarif an", () => {
    const result = planInputFromForm(form());
    assert.equal(result.success, true);
    assert.equal(result.success && result.data.memoryMb, 4096);
  });

  it("liest die Checkbox als false, wenn sie fehlt", () => {
    const result = planInputFromForm(form());
    assert.equal(result.success && result.data.isPublic, false);
  });

  it("liest die Checkbox als true bei \"on\"", () => {
    const data = form();
    data.set("isPublic", "on");
    const result = planInputFromForm(data);
    assert.equal(result.success && result.data.isPublic, true);
  });

  it("normalisiert die Kennung auf Kleinbuchstaben", () => {
    const result = planInputFromForm(form({ slug: "  BASIC  " }));
    assert.equal(result.success && result.data.slug, "basic");
  });

  it("lehnt Arbeitsspeicher unter der JVM-Untergrenze ab", () => {
    const result = planInputFromForm(
      form({ memoryMb: String(PLAN_MIN_MEMORY_MB - 1) }),
    );
    assert.equal(result.success, false);
    assert.ok(
      result.success === false && fieldErrors(result.error).memoryMb,
      "memoryMb muss einen Fehler melden",
    );
  });

  it("lehnt Kennungen mit Leerzeichen oder Großbuchstaben-Sonderzeichen ab", () => {
    for (const slug of ["mit leerzeichen", "-startetMitStrich", "a", "über"]) {
      const result = planInputFromForm(form({ slug }));
      assert.equal(result.success, false, `"${slug}" hätte abgelehnt werden müssen`);
    }
  });

  it("lehnt Nachkommastellen bei ganzzahligen Feldern ab", () => {
    const result = planInputFromForm(form({ maxPlayers: "20.5" }));
    assert.equal(result.success, false);
  });

  it("erlaubt halbe CPU-Kerne", () => {
    const result = planInputFromForm(form({ cpuCores: "0.5" }));
    assert.equal(result.success, true);
  });

  it("lehnt negative Preise ab", () => {
    const result = planInputFromForm(form({ priceCents: "-1" }));
    assert.equal(result.success, false);
  });

  it("erlaubt den Preis null für einen kostenlosen Tarif", () => {
    const result = planInputFromForm(form({ priceCents: "0" }));
    assert.equal(result.success, true);
  });

  it("sammelt pro Feld nur die erste Meldung", () => {
    const result = planInputFromForm(form({ slug: "!!", memoryMb: "1" }));
    assert.equal(result.success, false);

    if (result.success === false) {
      const errors = fieldErrors(result.error);
      assert.ok(errors.slug);
      assert.ok(errors.memoryMb);
      assert.equal(Object.keys(errors).length, 2);
    }
  });
});
