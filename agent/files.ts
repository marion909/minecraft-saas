import fs from "node:fs/promises";
import path from "node:path";

import { isProtected, safeResolve } from "./paths.ts";

/** Ab dieser Größe wird nicht mehr als Text ausgeliefert. */
export const MAX_TEXT_BYTES = 1024 * 1024;

/** Obergrenze pro Verzeichnis — eine Welt kann Zehntausende Dateien haben. */
export const MAX_ENTRIES = 500;

export type Entry = {
  name: string;
  type: "file" | "directory" | "other";
  sizeBytes: number;
  modifiedAt: string;
  /** Darf der Nutzer sie ändern? */
  editable: boolean;
};

export type Listing = {
  path: string;
  entries: Entry[];
  truncated: boolean;
};

export async function list(root: string, relative: string): Promise<Listing> {
  const resolved = await safeResolve(root, relative);
  const stat = await fs.stat(resolved.absolute);

  if (!stat.isDirectory()) {
    throw new Error("Das ist kein Verzeichnis.");
  }

  const dirents = await fs.readdir(resolved.absolute, { withFileTypes: true });
  const truncated = dirents.length > MAX_ENTRIES;

  const entries = await Promise.all(
    dirents.slice(0, MAX_ENTRIES).map(async (dirent) => {
      const full = path.join(resolved.absolute, dirent.name);
      const childRelative = path.join(resolved.relative, dirent.name);

      let sizeBytes = 0;
      let modifiedAt = new Date(0).toISOString();

      try {
        // lstat, nicht stat: Ein Symlink soll mit seiner eigenen Größe
        // erscheinen und nicht mit der seines Ziels.
        const info = await fs.lstat(full);
        sizeBytes = info.size;
        modifiedAt = info.mtime.toISOString();
      } catch {
        // Datei ist zwischen readdir und lstat verschwunden.
      }

      return {
        name: dirent.name,
        type: dirent.isDirectory()
          ? ("directory" as const)
          : dirent.isFile()
            ? ("file" as const)
            : ("other" as const),
        sizeBytes,
        modifiedAt,
        editable: !isProtected(childRelative),
      };
    }),
  );

  // Verzeichnisse zuerst, dann alphabetisch — so findet man sich wieder.
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, "de");
  });

  return { path: resolved.relative, entries, truncated };
}

export type FileContent =
  | { kind: "text"; path: string; content: string; sizeBytes: number }
  | { kind: "binary"; path: string; sizeBytes: number }
  | { kind: "too-large"; path: string; sizeBytes: number };

export async function read(
  root: string,
  relative: string,
): Promise<FileContent> {
  const resolved = await safeResolve(root, relative);
  const stat = await fs.stat(resolved.absolute);

  if (!stat.isFile()) throw new Error("Das ist keine Datei.");

  if (stat.size > MAX_TEXT_BYTES) {
    return { kind: "too-large", path: resolved.relative, sizeBytes: stat.size };
  }

  const buffer = await fs.readFile(resolved.absolute);

  // Ein Nullbyte im vorderen Bereich ist das verlässlichste Zeichen dafür,
  // dass die Datei nicht als Text gedacht ist — etwa ein .jar.
  if (buffer.subarray(0, 8000).includes(0)) {
    return { kind: "binary", path: resolved.relative, sizeBytes: stat.size };
  }

  return {
    kind: "text",
    path: resolved.relative,
    content: buffer.toString("utf8"),
    sizeBytes: stat.size,
  };
}

export async function write(
  root: string,
  relative: string,
  content: string,
): Promise<{ path: string; sizeBytes: number }> {
  const resolved = await safeResolve(root, relative);

  if (isProtected(resolved.relative)) {
    throw new Error(`"${resolved.relative}" darf nicht geändert werden.`);
  }

  await fs.mkdir(path.dirname(resolved.absolute), { recursive: true });
  await fs.writeFile(resolved.absolute, content, "utf8");

  return { path: resolved.relative, sizeBytes: Buffer.byteLength(content) };
}

export async function mkdir(root: string, relative: string): Promise<string> {
  const resolved = await safeResolve(root, relative);
  await fs.mkdir(resolved.absolute, { recursive: true });
  return resolved.relative;
}

export async function remove(root: string, relative: string): Promise<string> {
  const resolved = await safeResolve(root, relative);

  if (resolved.relative === "") {
    throw new Error("Das Serververzeichnis selbst kann nicht gelöscht werden.");
  }
  if (isProtected(resolved.relative)) {
    throw new Error(`"${resolved.relative}" darf nicht gelöscht werden.`);
  }

  await fs.rm(resolved.absolute, { recursive: true, force: true });
  return resolved.relative;
}

/** Zielpfad fürs Hochladen — geprüft, aber noch nicht geschrieben. */
export async function uploadTarget(
  root: string,
  relative: string,
): Promise<string> {
  const resolved = await safeResolve(root, relative);

  if (isProtected(resolved.relative)) {
    throw new Error(`"${resolved.relative}" darf nicht überschrieben werden.`);
  }

  await fs.mkdir(path.dirname(resolved.absolute), { recursive: true });
  return resolved.absolute;
}
