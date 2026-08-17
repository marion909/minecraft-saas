import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { gunzipSync } from "node:zlib";

import {
  checkEntries,
  checkPath,
  parseHeaderBlock,
  TarScanner,
  type TarEntry,
} from "./archive.ts";

/**
 * Alle Archive hier werden mit dem echten `tar` erzeugt.
 *
 * Handgebaute Header würden nur bestätigen, was ich beim Schreiben des
 * Parsers ohnehin angenommen habe. Erst ein Archiv, das tar selbst
 * geschrieben hat, beweist, dass er es liest — und auf macOS ist das
 * bsdtar mit pax-Headern, auf Linux GNU tar mit "L"-Einträgen. Beide
 * Sonderwege werden damit hier tatsächlich durchlaufen.
 */
let werkstatt: string;

function tar(args: string[], cwd: string): void {
  execFileSync("tar", args, { cwd, stdio: "pipe" });
}

/** Liest ein erzeugtes Archiv so, wie der Agent es täte. */
function scanne(archiv: string): TarEntry[] {
  const scanner = new TarScanner();
  scanner.push(gunzipSync(fs.readFileSync(archiv)));
  return scanner.entries;
}

/**
 * Namen ohne führendes „./“ und ohne die AppleDouble-Beifänge, die
 * bsdtar auf macOS für erweiterte Attribute einpackt. Auf dem Linux-Host
 * gibt es die nicht; im Test würden sie sonst die Suche nach dem
 * eigentlichen Eintrag stören.
 */
function nutzdaten(entries: TarEntry[]): TarEntry[] {
  return entries
    .map((entry) => ({ ...entry, name: entry.name.replace(/^\.\//, "") }))
    .filter((entry) => !path.basename(entry.name).startsWith("._"));
}

const GROSSZÜGIG = { maxTotalBytes: 1024 ** 3, maxEntries: 100_000 };

before(() => {
  werkstatt = fs.mkdtempSync(path.join(os.tmpdir(), "archivtest-"));
});

after(() => {
  fs.rmSync(werkstatt, { recursive: true, force: true });
});

describe("checkPath", () => {
  it("lässt gewöhnliche Serverpfade durch", () => {
    for (const name of [
      "welt/level.dat",
      "welt/region/r.0.0.mca",
      "plugins/EssentialsX.jar",
      "server.properties",
      "welt/",
      "ordner mit leerzeichen/datei.txt",
      "welt/DIM-1/data/villages.dat",
    ]) {
      assert.equal(checkPath(name), null, name);
    }
  });

  it("weist absolute Pfade ab", () => {
    assert.match(checkPath("/etc/passwd") ?? "", /Absoluter Pfad/);
  });

  it("weist „..“ ab, auch mitten im Pfad", () => {
    // Der zweite Fall ist der, den man übersieht: Er beginnt harmlos.
    for (const name of ["../etc/passwd", "welt/../../etc/cron.d/böse", ".."]) {
      assert.match(checkPath(name) ?? "", /\.\./, name);
    }
  });

  it("lässt Namen durch, die nur „..“ enthalten, ohne es zu sein", () => {
    // "..daten" ist ein zulässiger Dateiname und kein Ausbruch.
    assert.equal(checkPath("welt/..daten"), null);
    assert.equal(checkPath("welt/datei..txt"), null);
  });

  it("weist Nullbytes und Windows-Pfade ab", () => {
    assert.ok(checkPath("welt\0/böse"));
    assert.ok(checkPath("C:/Windows/system32"));
  });
});

describe("parseHeaderBlock", () => {
  it("erkennt den Nullblock am Archivende", () => {
    assert.equal(parseHeaderBlock(Buffer.alloc(512)), null);
  });

  it("gibt null für zu kurze Blöcke", () => {
    assert.equal(parseHeaderBlock(Buffer.alloc(100)), null);
  });
});

describe("TarScanner an echten Archiven", () => {
  it("liest ein gewöhnliches Weltarchiv vollständig", () => {
    const quelle = path.join(werkstatt, "normal");
    fs.mkdirSync(path.join(quelle, "welt", "region"), { recursive: true });
    fs.writeFileSync(path.join(quelle, "welt", "level.dat"), "x".repeat(1234));
    fs.writeFileSync(path.join(quelle, "welt", "region", "r.0.0.mca"), "y".repeat(99));
    fs.writeFileSync(path.join(quelle, "server.properties"), "motd=Test\n");

    const archiv = path.join(werkstatt, "normal.tar.gz");
    tar(["-czf", archiv, "."], quelle);

    const entries = nutzdaten(scanne(archiv));
    const namen = entries.map((entry) => entry.name);

    assert.ok(namen.includes("welt/level.dat"), `gefunden: ${namen.join(", ")}`);
    assert.ok(namen.includes("welt/region/r.0.0.mca"));
    assert.ok(namen.includes("server.properties"));

    const levelDat = entries.find((entry) => entry.name === "welt/level.dat");
    assert.equal(levelDat?.sizeBytes, 1234, "Größe aus dem Header");

    assert.equal(checkEntries(scanne(archiv), GROSSZÜGIG).ok, true);
  });

  it("weist ein Archiv mit symbolischem Verweis ab", () => {
    // Der klassische Ausbruch: Der Verweis selbst sieht harmlos aus,
    // der nächste Eintrag schreibt durch ihn hindurch.
    const quelle = path.join(werkstatt, "symlink");
    fs.mkdirSync(quelle, { recursive: true });
    fs.writeFileSync(path.join(quelle, "harmlos.txt"), "ok");
    fs.symlinkSync("/etc", path.join(quelle, "welt"));

    const archiv = path.join(werkstatt, "symlink.tar.gz");
    tar(["-czf", archiv, "."], quelle);

    const ergebnis = checkEntries(scanne(archiv), GROSSZÜGIG);
    assert.equal(ergebnis.ok, false);
    assert.match(
      ergebnis.ok === false ? ergebnis.problems[0]!.reason : "",
      /symbolischer Verweis/,
    );
  });

  it("weist ein Archiv mit hartem Verweis ab", () => {
    const quelle = path.join(werkstatt, "hardlink");
    fs.mkdirSync(quelle, { recursive: true });
    fs.writeFileSync(path.join(quelle, "eins.txt"), "inhalt");
    fs.linkSync(path.join(quelle, "eins.txt"), path.join(quelle, "zwei.txt"));

    const archiv = path.join(werkstatt, "hardlink.tar.gz");
    tar(["-czf", archiv, "."], quelle);

    const ergebnis = checkEntries(scanne(archiv), GROSSZÜGIG);
    assert.equal(ergebnis.ok, false);
    assert.match(
      ergebnis.ok === false ? ergebnis.problems[0]!.reason : "",
      /harter Verweis/,
    );
  });

  it("weist ein Archiv mit benannter Pipe ab", () => {
    const quelle = path.join(werkstatt, "fifo");
    fs.mkdirSync(quelle, { recursive: true });
    try {
      execFileSync("mkfifo", [path.join(quelle, "rohr")], { stdio: "pipe" });
    } catch {
      return; // Ohne mkfifo überspringen statt fälschlich bestehen.
    }

    const archiv = path.join(werkstatt, "fifo.tar.gz");
    tar(["-czf", archiv, "."], quelle);

    const ergebnis = checkEntries(scanne(archiv), GROSSZÜGIG);
    assert.equal(ergebnis.ok, false);
    assert.match(
      ergebnis.ok === false ? ergebnis.problems[0]!.reason : "",
      /Pipe/,
    );
  });

  it("weist absolute Pfade im Archiv ab", () => {
    // -P erhält führende Schrägstriche; genau so sähe ein Archiv aus,
    // das jemand mit Absicht gebaut hat.
    const archiv = path.join(werkstatt, "absolut.tar.gz");
    const quelle = path.join(werkstatt, "abs");
    fs.mkdirSync(quelle, { recursive: true });
    fs.writeFileSync(path.join(quelle, "datei"), "x");
    tar(["-czPf", archiv, path.join(quelle, "datei")], werkstatt);

    const ergebnis = checkEntries(scanne(archiv), GROSSZÜGIG);
    assert.equal(ergebnis.ok, false);
    assert.match(
      ergebnis.ok === false ? ergebnis.problems[0]!.reason : "",
      /Absoluter Pfad/,
    );
  });

  it("weist „..“ im Archiv ab", () => {
    const quelle = path.join(werkstatt, "aufstieg", "unten");
    fs.mkdirSync(quelle, { recursive: true });
    fs.writeFileSync(path.join(quelle, "datei"), "x");

    const archiv = path.join(werkstatt, "aufstieg.tar.gz");
    tar(["-czPf", archiv, "unten/../unten/datei"], path.join(werkstatt, "aufstieg"));

    const ergebnis = checkEntries(scanne(archiv), GROSSZÜGIG);
    assert.equal(ergebnis.ok, false);
    assert.match(ergebnis.ok === false ? ergebnis.problems[0]!.reason : "", /\.\./);
  });

  it("liest Namen über 100 Zeichen vollständig", () => {
    // Über 100 Zeichen passt der Name nicht mehr in den Header. tar legt
    // ihn dann als eigenen Eintrag davor — GNU als Typ „L“, bsdtar als
    // pax. Wer den überspringt, prüft einen abgeschnittenen Namen.
    const tief = Array.from({ length: 12 }, (_, i) => `ordner-nummer-${i}`).join("/");
    const quelle = path.join(werkstatt, "lang");
    fs.mkdirSync(path.join(quelle, tief), { recursive: true });
    fs.writeFileSync(path.join(quelle, tief, "level.dat"), "x");

    const archiv = path.join(werkstatt, "lang.tar.gz");
    tar(["-czf", archiv, "."], quelle);

    const voll = nutzdaten(scanne(archiv)).find((entry) =>
      entry.name.endsWith("/level.dat"),
    );

    assert.ok(voll, "Eintrag nicht gefunden");
    assert.ok(voll.name.length > 100, `Name war nur ${voll.name.length} Zeichen lang`);
    assert.ok(voll.name.includes("ordner-nummer-11"), voll.name);
  });

  it("weist einen langen Namen ab, der „..“ enthält", () => {
    // Der Fall, für den der Sonderweg überhaupt aufgelöst wird: Wäre nur
    // der gekürzte Header-Name geprüft worden, käme dieses Archiv durch.
    const ordner = Array.from({ length: 10 }, (_, i) => `füllordner-${i}`);
    const tief = ordner.join("/");
    const quelle = path.join(werkstatt, "langaufstieg");
    fs.mkdirSync(path.join(quelle, tief), { recursive: true });

    // Die Datei muss dort liegen, wohin „../..“ zeigt — sonst packt tar
    // gar nichts ein und der Test bestünde aus dem falschen Grund.
    const ziel = path.join(quelle, ordner.slice(0, -2).join("/"), "datei");
    fs.writeFileSync(ziel, "x");

    const archiv = path.join(werkstatt, "langaufstieg.tar.gz");
    const eintrag = `${tief}/../../datei`;
    tar(["-czPf", archiv, eintrag], quelle);
    assert.ok(eintrag.length > 100, "Testfall greift nur bei langen Namen");

    const ergebnis = checkEntries(scanne(archiv), GROSSZÜGIG);
    assert.equal(ergebnis.ok, false, "hätte abgewiesen werden müssen");
    assert.match(ergebnis.ok === false ? ergebnis.problems[0]!.reason : "", /\.\./);
  });
});

describe("checkEntries", () => {
  const datei = (name: string, sizeBytes = 10): TarEntry => ({
    name,
    type: "0",
    sizeBytes,
    linkname: "",
  });

  it("weist ein leeres Archiv ab", () => {
    const ergebnis = checkEntries([], GROSSZÜGIG);
    assert.equal(ergebnis.ok, false);
    assert.match(ergebnis.ok === false ? ergebnis.problems[0]!.reason : "", /keine Einträge/);
  });

  it("weist ein Archiv aus lauter Verzeichnissen ab", () => {
    // Beim Durchspielen gegen den echten Agent hat genau dieses Archiv
    // einen Server geleert: `tar -czf x.tar.gz -C leer .` enthält den
    // Eintrag "./" und wirkt damit gültig. Eingespielt löscht es die
    // Welt und schreibt nichts zurück.
    const ergebnis = checkEntries(
      [
        { name: "./", type: "5", sizeBytes: 0, linkname: "" },
        { name: "welt/", type: "5", sizeBytes: 0, linkname: "" },
      ],
      GROSSZÜGIG,
    );

    assert.equal(ergebnis.ok, false);
    assert.match(
      ergebnis.ok === false ? ergebnis.problems[0]!.reason : "",
      /keine Serverdaten/,
    );
  });

  it("lässt sich nicht von Metadateien des Betriebssystems täuschen", () => {
    // Beim zweiten Durchspielen kam genau dieses Archiv durch und hat
    // den Server erneut geleert: macOS legt zu jedem Eintrag eine
    // AppleDouble-Datei, und die zählte als Nutzdatei.
    const ergebnis = checkEntries(
      [
        { name: "._.", type: "0", sizeBytes: 163, linkname: "" },
        { name: "./", type: "5", sizeBytes: 0, linkname: "" },
        { name: "welt/.DS_Store", type: "0", sizeBytes: 6148, linkname: "" },
      ],
      GROSSZÜGIG,
    );

    assert.equal(ergebnis.ok, false, "hätte abgewiesen werden müssen");
    assert.match(
      ergebnis.ok === false ? ergebnis.problems[0]!.reason : "",
      /keine Serverdaten/,
    );
  });

  it("weist ein Archiv aus lauter leeren Dateien ab", () => {
    const ergebnis = checkEntries(
      [
        { name: "welt/level.dat", type: "0", sizeBytes: 0, linkname: "" },
        { name: "server.properties", type: "0", sizeBytes: 0, linkname: "" },
      ],
      GROSSZÜGIG,
    );

    assert.equal(ergebnis.ok, false);
  });

  it("lässt ein Archiv durch, das neben Beifang echte Daten enthält", () => {
    // Die Gegenprobe: Ein aus macOS hochgeladenes Weltarchiv enthält
    // beides und muss selbstverständlich funktionieren.
    const ergebnis = checkEntries(
      [
        { name: "._welt", type: "0", sizeBytes: 163, linkname: "" },
        { name: "welt/", type: "5", sizeBytes: 0, linkname: "" },
        { name: "welt/level.dat", type: "0", sizeBytes: 4096, linkname: "" },
      ],
      GROSSZÜGIG,
    );

    assert.equal(ergebnis.ok, true);
  });

  it("weist ab, was entpackt nicht auf die Platte passt", () => {
    const ergebnis = checkEntries([datei("welt/level.dat", 900_000_000)], {
      maxTotalBytes: 100_000_000,
      maxEntries: 1000,
    });

    assert.equal(ergebnis.ok, false);
    assert.match(
      ergebnis.ok === false ? ergebnis.problems[0]!.reason : "",
      /858 MB.*95 MB/,
    );
  });

  it("weist zu viele Einträge ab, ohne alle zu prüfen", () => {
    const viele = Array.from({ length: 50 }, (_, i) => datei(`datei-${i}`));
    const ergebnis = checkEntries(viele, { maxTotalBytes: 1024 ** 3, maxEntries: 10 });

    assert.equal(ergebnis.ok, false);
    assert.match(ergebnis.ok === false ? ergebnis.problems[0]!.reason : "", /50 Einträge/);
  });

  it("sammelt mehrere Beanstandungen, statt bei der ersten aufzuhören", () => {
    const ergebnis = checkEntries(
      [
        datei("../raus"),
        { name: "link", type: "2", sizeBytes: 0, linkname: "/etc" },
        datei("/absolut"),
        datei("welt/ok.dat"),
      ],
      GROSSZÜGIG,
    );

    assert.equal(ergebnis.ok, false);
    assert.equal(ergebnis.ok === false ? ergebnis.problems.length : 0, 3);
  });

  it("deckelt die Liste der Beanstandungen", () => {
    const kaputt = Array.from({ length: 40 }, (_, i) => datei(`../raus-${i}`));
    const ergebnis = checkEntries(kaputt, GROSSZÜGIG);

    assert.equal(ergebnis.ok === false && ergebnis.problems.length, 10);
  });

  it("nennt bei einem Verweis dessen Ziel", () => {
    const ergebnis = checkEntries(
      [{ name: "welt", type: "2", sizeBytes: 0, linkname: "/etc/shadow" }],
      GROSSZÜGIG,
    );

    assert.match(
      ergebnis.ok === false ? ergebnis.problems[0]!.reason : "",
      /\/etc\/shadow/,
    );
  });

  it("zählt die Gesamtgröße aus den Headern", () => {
    const ergebnis = checkEntries(
      [datei("a", 1000), datei("b", 2000), { name: "d/", type: "5", sizeBytes: 0, linkname: "" }],
      GROSSZÜGIG,
    );

    assert.equal(ergebnis.ok, true);
    assert.equal(ergebnis.ok === true ? ergebnis.totalBytes : 0, 3000);
    assert.equal(ergebnis.ok === true ? ergebnis.entries : 0, 3);
  });
});
