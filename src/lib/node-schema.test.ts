import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fieldErrors, nodeInput, nodeInputFromForm } from "./node-schema.ts";

/** Ein Node, wie der Host des Autors ihn beschreibt. */
function gültig(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const base: Record<string, string> = {
    name: "hetzner-1",
    agentUrl: "http://127.0.0.1:8787",
    agentToken: "0123456789abcdef0123",
    publicHost: "mc.neuhauser.app",
    totalMemoryMb: "65536",
    totalCpuCores: "16",
    totalDiskMb: "900000",
    reservedMemoryMb: "8192",
    reservedDiskMb: "51200",
    cpuOvercommit: "2",
    status: "ONLINE",
    ...overrides,
  };

  for (const [key, value] of Object.entries(base)) form.set(key, value);
  return form;
}

function fehlerBei(overrides: Record<string, string>): Record<string, string> {
  const parsed = nodeInputFromForm(gültig(overrides));
  assert.equal(parsed.success, false, "hätte abgewiesen werden müssen");
  return fieldErrors(parsed.error);
}

describe("nodeInput", () => {
  it("nimmt einen vollständigen Node an", () => {
    const parsed = nodeInputFromForm(gültig());
    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.totalMemoryMb, 65_536);
    assert.equal(parsed.data?.cpuOvercommit, 2);
    assert.equal(parsed.data?.status, "ONLINE");
  });

  it("erlaubt ein leeres Token — beim Bearbeiten heißt das unverändert", () => {
    const parsed = nodeInputFromForm(gültig({ agentToken: "" }));
    assert.equal(parsed.success, true);
    assert.equal(parsed.data?.agentToken, "");
  });

  it("weist zu kurze Token ab", () => {
    // Das Token bedeutet root auf dem Host; "test" wäre in Minuten geraten.
    assert.match(fehlerBei({ agentToken: "test" }).agentToken ?? "", /16 Zeichen/);
  });

  describe("agentUrl", () => {
    it("verlangt ein Schema", () => {
      assert.ok(fehlerBei({ agentUrl: "127.0.0.1:8787" }).agentUrl);
    });

    it("lässt nur http und https zu", () => {
      // z.url() allein akzeptiert ftp:// — deshalb die zusätzliche Prüfung.
      assert.equal(fehlerBei({ agentUrl: "ftp://127.0.0.1" }).agentUrl, "Nur http oder https.");
    });

    it("weist einen abschließenden Schrägstrich ab", () => {
      // Der Client hängt Pfade direkt an; sonst entstünde //health.
      assert.match(
        fehlerBei({ agentUrl: "http://127.0.0.1:8787/" }).agentUrl ?? "",
        /Schrägstrich/,
      );
    });

    it("nimmt https und einen Hostnamen ohne Punkt an", () => {
      // Im Docker-Netz sind Namen wie "agent" gültige Ziele.
      for (const url of ["https://node2.intern:8787", "http://agent:8787"]) {
        assert.equal(nodeInputFromForm(gültig({ agentUrl: url })).success, true, url);
      }
    });
  });

  describe("publicHost", () => {
    it("nimmt gewöhnliche Namen an", () => {
      for (const host of ["mc.neuhauser.app", "spiel.example.co.uk", "a.de"]) {
        assert.equal(nodeInputFromForm(gültig({ publicHost: host })).success, true, host);
      }
    });

    it("weist Schema, Port und Pfad ab", () => {
      for (const host of [
        "http://mc.example.com",
        "mc.example.com:25565",
        "mc.example.com/pfad",
      ]) {
        assert.ok(fehlerBei({ publicHost: host }).publicHost, host);
      }
    });

    it("verlangt einen Punkt", () => {
      // Ohne Punkt entstünde als Serveradresse "meinserver.localhost" —
      // das löst kein Client außerhalb des Hosts auf.
      assert.ok(fehlerBei({ publicHost: "localhost" }).publicHost);
    });

    it("weist führende und schließende Bindestriche ab", () => {
      for (const host of ["-mc.example.com", "mc-.example.com", "mc.-example.com"]) {
        assert.ok(fehlerBei({ publicHost: host }).publicHost, host);
      }
    });

    it("schreibt klein", () => {
      const parsed = nodeInputFromForm(gültig({ publicHost: "MC.Example.COM" }));
      assert.equal(parsed.data?.publicHost, "mc.example.com");
    });
  });

  describe("Reserve gegen Gesamtgröße", () => {
    it("weist eine Reserve ab, die alles auffrisst", () => {
      // Sonst wäre die Kapazität null, und das Anlegen scheiterte mit
      // einer Meldung, die auf den Tarif zeigt statt auf den Node.
      assert.match(
        fehlerBei({ reservedMemoryMb: "65536" }).reservedMemoryMb ?? "",
        /kleiner/,
      );
      assert.match(
        fehlerBei({ reservedDiskMb: "900000" }).reservedDiskMb ?? "",
        /kleiner/,
      );
    });

    it("erlaubt eine Reserve knapp darunter", () => {
      assert.equal(
        nodeInputFromForm(gültig({ reservedMemoryMb: "65535" })).success,
        true,
      );
    });
  });

  describe("cpuOvercommit", () => {
    it("weist Werte unter 1 ab", () => {
      assert.ok(fehlerBei({ cpuOvercommit: "0.5" }).cpuOvercommit);
    });

    it("nimmt 1 bis 8 an", () => {
      for (const value of ["1", "2.5", "8"]) {
        assert.equal(nodeInputFromForm(gültig({ cpuOvercommit: value })).success, true, value);
      }
    });

    it("weist Werte über 8 ab", () => {
      assert.ok(fehlerBei({ cpuOvercommit: "16" }).cpuOvercommit);
    });
  });

  it("weist unbekannte Zustände ab", () => {
    assert.ok(fehlerBei({ status: "WARTUNG" }).status);
  });

  it("weist Text in Zahlenfeldern ab", () => {
    assert.ok(fehlerBei({ totalMemoryMb: "viel" }).totalMemoryMb);
  });

  it("nennt jedes fehlerhafte Feld genau einmal", () => {
    const errors = fehlerBei({ name: "x", cpuOvercommit: "99", status: "?" });
    assert.deepEqual(Object.keys(errors).sort(), ["cpuOvercommit", "name", "status"]);
  });

  it("hat kein Feld, das nur im Schema steht", () => {
    // Fällt auf, wenn dem Schema ein Feld zuwächst und das Formular es
    // nicht mitschickt — dann wäre es beim Speichern still leer.
    const parsed = nodeInput.safeParse({});
    assert.equal(parsed.success, false);

    const fehlend = new Set(
      parsed.error!.issues.map((issue) => String(issue.path[0])),
    );
    const ausFormular = new Set(Object.keys(fieldErrors(parsed.error!)));

    for (const feld of fehlend) {
      assert.ok(ausFormular.has(feld), `${feld} fehlt in nodeInputFromForm`);
    }
  });
});
