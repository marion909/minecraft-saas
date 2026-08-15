import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeCapacity,
  fits,
  heapForContainer,
  placeServer,
  type Allocated,
  type NodeLimits,
} from "./capacity.ts";

/** Die Zielhardware: i5-12500, 48 GB RAM, 1-TB-SSD als ZFS-Pool. */
const NODE: NodeLimits = {
  totalMemoryMb: 49_152,
  totalCpuCores: 12,
  totalDiskMb: 953_000,
  reservedMemoryMb: 12_288,
  reservedDiskMb: 190_000,
  cpuOvercommit: 1.5,
};

const NOTHING: Allocated = { memoryMb: 0, cpuCores: 0, diskMb: 0 };

describe("computeCapacity", () => {
  it("zieht den reservierten Anteil vom Arbeitsspeicher ab", () => {
    const capacity = computeCapacity(NODE, NOTHING);
    assert.equal(capacity.memoryMb.capacity, 36_864);
    assert.equal(capacity.memoryMb.free, 36_864);
  });

  it("wendet den Überbuchungsfaktor nur auf die CPU an", () => {
    const capacity = computeCapacity(NODE, NOTHING);
    assert.equal(capacity.cpuCores.capacity, 18);
    assert.equal(capacity.diskMb.capacity, 763_000);
  });

  it("rechnet belegte Ressourcen ab", () => {
    const capacity = computeCapacity(NODE, {
      memoryMb: 8192,
      cpuCores: 4,
      diskMb: 50_000,
    });
    assert.equal(capacity.memoryMb.free, 28_672);
    assert.equal(capacity.cpuCores.free, 14);
    assert.equal(capacity.diskMb.free, 713_000);
  });

  it("meldet nie negativen freien Platz, auch bei Überbelegung", () => {
    const capacity = computeCapacity(NODE, {
      memoryMb: 99_999,
      cpuCores: 99,
      diskMb: 9_999_999,
    });
    assert.equal(capacity.memoryMb.free, 0);
    assert.equal(capacity.cpuCores.free, 0);
    assert.equal(capacity.diskMb.free, 0);
  });

  it("verkraftet einen Node, dessen Reserve größer ist als er selbst", () => {
    const capacity = computeCapacity(
      { ...NODE, reservedMemoryMb: 999_999 },
      NOTHING,
    );
    assert.equal(capacity.memoryMb.capacity, 0);
  });

  it("behandelt einen Überbuchungsfaktor unter 1 wie 1", () => {
    const capacity = computeCapacity({ ...NODE, cpuOvercommit: 0.2 }, NOTHING);
    assert.equal(capacity.cpuCores.capacity, 12);
  });
});

describe("fits", () => {
  const capacity = computeCapacity(NODE, NOTHING);

  it("lässt einen Server durch, der hineinpasst", () => {
    assert.deepEqual(
      fits(capacity, { memoryMb: 4096, cpuCores: 2, diskMb: 25_000 }),
      { ok: true },
    );
  });

  it("nennt den Arbeitsspeicher als Grund, wenn er nicht reicht", () => {
    const result = fits(capacity, {
      memoryMb: 40_000,
      cpuCores: 1,
      diskMb: 1000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.dimension, "memoryMb");
  });

  it("prüft den Speicherplatz vor der CPU, weil er die härtere Grenze ist", () => {
    const result = fits(capacity, {
      memoryMb: 1024,
      cpuCores: 99,
      diskMb: 900_000,
    });
    assert.equal(result.ok === false && result.dimension, "diskMb");
  });

  it("lässt genau die neun Server à 4 GB zu, die der Node hergibt", () => {
    let free = computeCapacity(NODE, NOTHING);
    const used: Allocated = { memoryMb: 0, cpuCores: 0, diskMb: 0 };
    let placed = 0;

    while (
      fits(free, { memoryMb: 4096, cpuCores: 2, diskMb: 25_000 }).ok
    ) {
      used.memoryMb += 4096;
      used.cpuCores += 2;
      used.diskMb += 25_000;
      free = computeCapacity(NODE, used);
      placed += 1;
    }

    assert.equal(placed, 9);
  });
});

describe("heapForContainer", () => {
  it("hält bei 4 GB Limit einen Sicherheitsabstand zum OOM-Killer", () => {
    assert.equal(heapForContainer(4096), 3328);
  });

  it("nutzt bei großen Containern die prozentuale Reserve", () => {
    // 15 % von 16384 sind 2458 und damit mehr als die 768-MB-Untergrenze.
    assert.equal(heapForContainer(16_384), 16_384 - 2458);
  });

  it("gibt niemals den vollen Container-Speicher als Heap frei", () => {
    for (const limit of [1280, 2048, 4096, 8192, 16_384, 32_768]) {
      assert.ok(
        heapForContainer(limit) < limit,
        `Heap muss unter dem Limit ${limit} liegen`,
      );
    }
  });

  it("lehnt zu kleine Container ab, statt einen unbrauchbaren Heap zu liefern", () => {
    assert.throws(() => heapForContainer(1024), /zu klein/);
  });
});

describe("placeServer", () => {
  /** Ein kleiner Node, damit sich Grenzen ohne große Zahlen erreichen lassen. */
  function node(name: string, memoryMb: number): NodeLimits & { name: string } {
    return {
      name,
      totalMemoryMb: memoryMb,
      totalCpuCores: 8,
      totalDiskMb: 500_000,
      reservedMemoryMb: 0,
      reservedDiskMb: 0,
      cpuOvercommit: 2,
    };
  }

  const KLEIN = { memoryMb: 4096, cpuCores: 1, diskMb: 20_000 };

  it("meldet einen sprechenden Grund, wenn gar kein Node da ist", () => {
    const result = placeServer([], KLEIN);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /ONLINE/);
  });

  it("nimmt den einzigen Node, auf den es passt", () => {
    const result = placeServer(
      [{ node: node("a", 8192), allocated: NOTHING }],
      KLEIN,
    );
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.node.name, "a");
  });

  it("verteilt auf den Node mit dem meisten freien Speicher", () => {
    // Nicht vollpacken: Ein randvoller Node hat keine Luft mehr, wenn ein
    // Server per Tarifwechsel größer wird.
    const result = placeServer(
      [
        { node: node("fast-voll", 16_384), allocated: { memoryMb: 12_288, cpuCores: 3, diskMb: 100_000 } },
        { node: node("leer", 16_384), allocated: NOTHING },
        { node: node("halb", 16_384), allocated: { memoryMb: 8192, cpuCores: 2, diskMb: 50_000 } },
      ],
      KLEIN,
    );

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.node.name, "leer");
  });

  it("überspringt volle Nodes und nimmt den, auf dem noch Platz ist", () => {
    // Der eigentliche Zweck eines zweiten Nodes. Vorher wurde nur der
    // erste betrachtet und das Anlegen abgelehnt, obwohl Platz da war.
    const result = placeServer(
      [
        { node: node("voll", 8192), allocated: { memoryMb: 8192, cpuCores: 4, diskMb: 400_000 } },
        { node: node("frei", 8192), allocated: NOTHING },
      ],
      KLEIN,
    );

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.node.name, "frei");
  });

  it("scheitert an der Platte, auch wenn der Speicher reichen würde", () => {
    const eng = { ...node("platte-voll", 65_536), totalDiskMb: 30_000 };
    const result = placeServer(
      [{ node: eng, allocated: { memoryMb: 0, cpuCores: 0, diskMb: 25_000 } }],
      KLEIN,
    );

    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /Speicherplatz/);
  });

  it("begründet mit dem aussichtsreichsten Node, nicht mit einem beliebigen", () => {
    // Der zweite ist näher dran; seine Zahl hilft weiter, die des
    // winzigen ersten führt in die Irre.
    const result = placeServer(
      [
        { node: node("winzig", 2048), allocated: NOTHING },
        { node: node("knapp", 8192), allocated: { memoryMb: 5120, cpuCores: 0, diskMb: 0 } },
      ],
      KLEIN,
    );

    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /3072 MB verfügbar/);
  });

  it("gibt die Kapazität des gewählten Nodes mit zurück", () => {
    const result = placeServer(
      [{ node: node("a", 8192), allocated: { memoryMb: 2048, cpuCores: 1, diskMb: 10_000 } }],
      KLEIN,
    );

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.capacity.memoryMb.free, 8192 - 2048);
  });
});
