import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeCapacity,
  fits,
  heapForContainer,
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
