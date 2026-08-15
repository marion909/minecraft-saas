/**
 * Ressourcen-Buchhaltung für einen Node.
 *
 * Bewusst als reine Funktion gehalten: die Regeln sind der Teil, der
 * wehtut, wenn er falsch ist, und der lässt sich so ohne Datenbank testen.
 *
 * Die Regeln aus dem Bauplan:
 *   RAM  — wird nie überbucht. Eine JVM belegt ihren Heap tatsächlich und
 *          gibt ihn nicht zurück; Überbuchung endet in OOM-Kills auf dem Host.
 *   CPU  — darf überbucht werden, Server sind die meiste Zeit im Leerlauf.
 *   Disk — wird nicht überbucht, ZFS-Quotas sind harte Grenzen.
 */

export type ResourceRequest = {
  memoryMb: number;
  cpuCores: number;
  diskMb: number;
};

export type NodeLimits = {
  totalMemoryMb: number;
  totalCpuCores: number;
  totalDiskMb: number;
  reservedMemoryMb: number;
  reservedDiskMb: number;
  cpuOvercommit: number;
};

export type Allocated = {
  memoryMb: number;
  cpuCores: number;
  diskMb: number;
};

export type Dimension = {
  capacity: number;
  allocated: number;
  free: number;
};

export type Capacity = {
  memoryMb: Dimension;
  cpuCores: Dimension;
  diskMb: Dimension;
};

export function computeCapacity(
  limits: NodeLimits,
  allocated: Allocated,
): Capacity {
  const memoryCapacity = Math.max(
    0,
    limits.totalMemoryMb - limits.reservedMemoryMb,
  );
  const diskCapacity = Math.max(0, limits.totalDiskMb - limits.reservedDiskMb);
  const cpuCapacity = Math.max(
    0,
    limits.totalCpuCores * Math.max(1, limits.cpuOvercommit),
  );

  return {
    memoryMb: dimension(memoryCapacity, allocated.memoryMb),
    cpuCores: dimension(cpuCapacity, allocated.cpuCores),
    diskMb: dimension(diskCapacity, allocated.diskMb),
  };
}

function dimension(capacity: number, allocated: number): Dimension {
  return {
    capacity,
    allocated,
    free: Math.max(0, capacity - allocated),
  };
}

export type FitResult =
  | { ok: true }
  | { ok: false; dimension: "memoryMb" | "cpuCores" | "diskMb"; reason: string };

/**
 * Passt die Anforderung noch auf den Node? Wird vor jedem Anlegen und vor
 * jedem Plan-Upgrade aufgerufen.
 */
export function fits(capacity: Capacity, request: ResourceRequest): FitResult {
  if (request.memoryMb > capacity.memoryMb.free) {
    return {
      ok: false,
      dimension: "memoryMb",
      reason:
        `Nicht genug Arbeitsspeicher frei: ${request.memoryMb} MB angefordert, ` +
        `${capacity.memoryMb.free} MB verfügbar.`,
    };
  }

  if (request.diskMb > capacity.diskMb.free) {
    return {
      ok: false,
      dimension: "diskMb",
      reason:
        `Nicht genug Speicherplatz frei: ${request.diskMb} MB angefordert, ` +
        `${capacity.diskMb.free} MB verfügbar.`,
    };
  }

  if (request.cpuCores > capacity.cpuCores.free) {
    return {
      ok: false,
      dimension: "cpuCores",
      reason:
        `Nicht genug CPU frei: ${request.cpuCores} Kerne angefordert, ` +
        `${round(capacity.cpuCores.free)} verfügbar (inkl. Überbuchung).`,
    };
  }

  return { ok: true };
}

/**
 * Container-Limit und JVM-Heap dürfen nicht identisch sein: die JVM braucht
 * zusätzlich Metaspace, Thread-Stacks, Direct Buffers und GC-Strukturen.
 * Ist der Heap so groß wie das Limit, killt der OOM-Killer den Server
 * irgendwann mitten im Spiel — ohne dass die Welt gespeichert wird.
 */
export function heapForContainer(containerMemoryMb: number): number {
  const overhead = Math.max(768, Math.round(containerMemoryMb * 0.15));
  const heap = containerMemoryMb - overhead;

  if (heap < 512) {
    throw new Error(
      `Container-Limit von ${containerMemoryMb} MB ist zu klein: ` +
        `nach ${overhead} MB JVM-Overhead blieben nur ${heap} MB Heap. ` +
        `Minimum sind 1280 MB Limit.`,
    );
  }

  return heap;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
