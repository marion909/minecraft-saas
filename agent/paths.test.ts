import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  isInside,
  isProtected,
  normalizeRelative,
  PathViolation,
  safeResolve,
} from "./paths.ts";

describe("normalizeRelative", () => {
  it("lässt gewöhnliche Pfade durch", () => {
    assert.equal(normalizeRelative("plugins/Essentials.jar"), path.normalize("plugins/Essentials.jar"));
    assert.equal(normalizeRelative("server.properties"), "server.properties");
  });

  it("macht aus absoluten Pfaden relative", () => {
    // Ohne das würde path.resolve die Wurzel schlicht ignorieren.
    assert.equal(normalizeRelative("/etc/passwd"), path.normalize("etc/passwd"));
    assert.equal(normalizeRelative("///etc/passwd"), path.normalize("etc/passwd"));
  });

  it("weist Ausbrüche über .. ab", () => {
    for (const input of ["../etc/passwd", "..", "plugins/../../../etc", "a/../../b"]) {
      assert.throws(
        () => normalizeRelative(input),
        PathViolation,
        `"${input}" hätte abgewiesen werden müssen`,
      );
    }
  });

  it("erlaubt .. solange es innerhalb bleibt", () => {
    assert.equal(normalizeRelative("plugins/../world"), "world");
  });

  it("weist Nullbytes ab", () => {
    assert.throws(() => normalizeRelative("datei\0.txt"), PathViolation);
  });

  it("macht aus dem Punkt die Wurzel", () => {
    assert.equal(normalizeRelative("."), "");
    assert.equal(normalizeRelative("/"), "");
  });
});

describe("isInside", () => {
  it("erkennt echte Kindpfade", () => {
    assert.ok(isInside("/srv/mc/a", "/srv/mc/a/world"));
    assert.ok(isInside("/srv/mc/a", "/srv/mc/a"));
  });

  it("lässt sich nicht von gleichem Präfix täuschen", () => {
    // Der klassische Fehler: startsWith ohne Trennzeichen.
    assert.ok(!isInside("/srv/mc/a", "/srv/mc/abc"));
    assert.ok(!isInside("/srv/mc/a", "/srv/mc/a-backup"));
  });
});

describe("safeResolve", () => {
  let root: string;
  let outside: string;

  before(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "mcsaas-paths-"));
    root = path.join(base, "data");
    outside = path.join(base, "geheim");

    await fs.mkdir(path.join(root, "plugins"), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(root, "server.properties"), "motd=hi\n");
    await fs.writeFile(path.join(outside, "passwoerter.txt"), "streng geheim");
  });

  after(async () => {
    await fs.rm(path.dirname(root), { recursive: true, force: true });
  });

  it("löst eine vorhandene Datei auf", async () => {
    const resolved = await safeResolve(root, "server.properties");
    assert.equal(resolved.exists, true);
    assert.equal(resolved.relative, "server.properties");
  });

  it("erlaubt noch nicht vorhandene Dateien in vorhandenen Ordnern", async () => {
    // Nötig fürs Hochladen und Anlegen.
    const resolved = await safeResolve(root, "plugins/Neu.jar");
    assert.equal(resolved.exists, false);
    assert.equal(resolved.relative, path.normalize("plugins/Neu.jar"));
  });

  it("erlaubt tief verschachtelte neue Pfade", async () => {
    const resolved = await safeResolve(root, "a/b/c/d.txt");
    assert.equal(resolved.exists, false);
  });

  it("weist Ausbruch über .. ab", async () => {
    await assert.rejects(
      () => safeResolve(root, "../geheim/passwoerter.txt"),
      PathViolation,
    );
  });

  it("weist absolute Pfade ab, indem es sie einbettet", async () => {
    // "/etc/passwd" wird zu "<root>/etc/passwd" — existiert nicht,
    // führt aber auch nirgendwo hin.
    const resolved = await safeResolve(root, "/etc/passwd");
    assert.ok(resolved.absolute.startsWith(await fs.realpath(root)));
  });

  it("folgt keinem Symlink aus dem Verzeichnis heraus", async () => {
    // Der eigentliche Angriff: Im Container lässt sich jederzeit ein
    // Symlink anlegen. Ohne realpath würde der Agent ihm mit seinen
    // eigenen Rechten folgen.
    const link = path.join(root, "raus");
    await fs.symlink(outside, link).catch(() => {});

    await assert.rejects(() => safeResolve(root, "raus"), PathViolation);
    await assert.rejects(
      () => safeResolve(root, "raus/passwoerter.txt"),
      PathViolation,
    );
  });

  it("erlaubt Symlinks, die innerhalb bleiben", async () => {
    const link = path.join(root, "welt-link");
    await fs.symlink(path.join(root, "plugins"), link).catch(() => {});

    const resolved = await safeResolve(root, "welt-link");
    assert.equal(resolved.relative, "plugins");
  });

  it("verkraftet eine Wurzel, die selbst ein Symlink ist", async () => {
    const alias = path.join(path.dirname(root), "alias");
    await fs.symlink(root, alias).catch(() => {});

    const resolved = await safeResolve(alias, "server.properties");
    assert.equal(resolved.relative, "server.properties");
  });

  it("gibt für die Wurzel selbst einen leeren relativen Pfad", async () => {
    const resolved = await safeResolve(root, "");
    assert.equal(resolved.relative, "");
    assert.equal(resolved.exists, true);
  });
});

describe("isProtected", () => {
  it("schützt die EULA vor dem Überschreiben", () => {
    assert.ok(isProtected("eula.txt"));
    assert.ok(!isProtected("plugins/eula.txt"));
    assert.ok(!isProtected("server.properties"));
  });
});
