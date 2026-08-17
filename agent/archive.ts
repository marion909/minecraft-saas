/**
 * Prüfung hochgeladener Backup-Archive.
 *
 * Ein Archiv aus dem Netz zu entpacken ist der klassische Weg, aus einem
 * Verzeichnis auszubrechen: ein Eintrag namens `../../etc/cron.d/böse`,
 * oder ein Symlink `welt -> /etc` gefolgt von `welt/passwd`. Deshalb wird
 * hier jeder Eintrag angesehen, bevor `tar` das Archiv überhaupt zu
 * Gesicht bekommt.
 *
 * Gelesen wird das tar-Format selbst, nicht die Ausgabe von `tar -tv`:
 * Die unterscheidet sich zwischen GNU tar (Linux) und bsdtar (macOS) in
 * Spaltenzahl und Kodierung — GNU escaped Umlaute als `\303\266`. Ein
 * Parser darauf wäre plattformabhängig, und zwar genau an der Stelle, an
 * der er es nicht sein darf. Das Header-Format dagegen ist seit POSIX.1
 * unverändert: 512 Byte, feste Offsets.
 */

/** Ein tar-Header ist immer genau so lang, Daten werden darauf aufgerundet. */
export const BLOCK_SIZE = 512;

export type TarEntry = {
  name: string;
  /** POSIX-Typflag: "0" Datei, "5" Verzeichnis, "2" Symlink, … */
  type: string;
  sizeBytes: number;
  linkname: string;
};

/**
 * Was ein Welt-Archiv enthalten darf. Alles andere hat in einem
 * Minecraft-Serververzeichnis nichts verloren und ist im Zweifel ein
 * Angriff: Symlinks führen aus dem Baum heraus, Gerätedateien und
 * setuid-Programme gehören dort ohnehin nicht hin.
 */
const ERLAUBTE_TYPEN = new Set([
  "0", // reguläre Datei
  "\0", // reguläre Datei, altes Format
  "5", // Verzeichnis
]);

const TYP_NAMEN: Record<string, string> = {
  "1": "harter Verweis",
  "2": "symbolischer Verweis",
  "3": "Zeichengerät",
  "4": "Blockgerät",
  "6": "benannte Pipe",
  "7": "reservierter Typ",
};

function text(block: Buffer, offset: number, length: number): string {
  const raw = block.subarray(offset, offset + length);
  const ende = raw.indexOf(0);
  return raw.subarray(0, ende === -1 ? raw.length : ende).toString("utf8");
}

/** Zahlen stehen im tar-Header oktal und mit Leerzeichen aufgefüllt. */
function octal(block: Buffer, offset: number, length: number): number {
  const wert = text(block, offset, length).trim();
  if (!wert) return 0;
  const zahl = Number.parseInt(wert, 8);
  return Number.isFinite(zahl) && zahl >= 0 ? zahl : 0;
}

/**
 * Liest einen 512-Byte-Header. Gibt null zurück für den Nullblock, mit
 * dem ein Archiv endet.
 */
export function parseHeaderBlock(block: Buffer): TarEntry | null {
  if (block.length < BLOCK_SIZE) return null;
  // Ein Block aus lauter Nullen markiert das Ende des Archivs.
  if (block.every((byte) => byte === 0)) return null;

  const name = text(block, 0, 100);
  // Bei ustar kann ein langer Pfad auf prefix und name aufgeteilt sein.
  // Wer das übersieht, prüft den halben Namen — und der sieht harmlos aus.
  const prefix = text(block, 345, 155);

  return {
    name: prefix ? `${prefix}/${name}` : name,
    type: block.subarray(156, 157).toString("binary") || "0",
    sizeBytes: octal(block, 124, 12),
    linkname: text(block, 157, 100),
  };
}

export type ArchiveProblem = { entry: string; reason: string };

/**
 * Prüft einen einzelnen Pfad auf Ausbruchsversuche.
 *
 * Bewusst gegen den Namen aus dem Archiv, nicht gegen einen aufgelösten
 * Pfad: Was `tar` daraus machen würde, hängt von Version und Optionen ab.
 * Was hier nicht durchkommt, kann keine Option wieder hereinlassen.
 */
export function checkPath(name: string): string | null {
  if (!name) return "Eintrag ohne Namen.";

  if (name.startsWith("/")) {
    return "Absoluter Pfad — würde außerhalb des Serververzeichnisses landen.";
  }

  // Auch mitten im Pfad: "welt/../../etc" ist genauso ein Ausbruch.
  const teile = name.split("/");
  if (teile.includes("..")) {
    return "Enthält „..“ — führt aus dem Serververzeichnis heraus.";
  }

  // Ein Laufwerksbuchstabe wäre unter Linux ein gewöhnlicher Dateiname,
  // aber ein Archiv mit "C:\" kommt nicht von einem Minecraft-Server.
  if (/^[a-zA-Z]:/.test(name)) {
    return "Windows-Pfad mit Laufwerksbuchstabe.";
  }

  if (name.includes("\0")) {
    return "Nullbyte im Namen.";
  }

  return null;
}

/**
 * Beifang der Betriebssysteme, der in fast jedem Archiv landet und nie
 * für sich allein ein Backup ausmacht: AppleDouble-Dateien von macOS,
 * Thumbnail-Datenbanken von Windows, Ordnereinstellungen.
 */
function istMetadatei(name: string): boolean {
  const basis = name.split("/").pop() ?? "";
  return (
    basis.startsWith("._") ||
    basis === ".DS_Store" ||
    basis === "Thumbs.db" ||
    basis === "desktop.ini"
  );
}

export type ArchiveLimits = {
  /** Gesamtgröße entpackt. Schützt vor Archiven, die sich vervielfachen. */
  maxTotalBytes: number;
  maxEntries: number;
};

export type ArchiveCheck =
  | { ok: true; entries: number; totalBytes: number }
  | { ok: false; problems: ArchiveProblem[] };

/**
 * Beurteilt die gesammelten Einträge eines Archivs.
 *
 * Sammelt bis zu zehn Beanstandungen, statt bei der ersten abzubrechen:
 * Wer ein Archiv aus einer anderen Quelle einspielt, will wissen, was
 * insgesamt daran nicht passt, und nicht nach jeder Korrektur erneut
 * hundert Megabyte hochladen.
 */
export function checkEntries(
  entries: TarEntry[],
  limits: ArchiveLimits,
): ArchiveCheck {
  const problems: ArchiveProblem[] = [];
  let totalBytes = 0;

  if (entries.length === 0) {
    return {
      ok: false,
      problems: [{ entry: "(Archiv)", reason: "Enthält keine Einträge." }],
    };
  }

  if (entries.length > limits.maxEntries) {
    return {
      ok: false,
      problems: [
        {
          entry: "(Archiv)",
          reason:
            `Enthält ${entries.length} Einträge, erlaubt sind ` +
            `${limits.maxEntries}.`,
        },
      ],
    };
  }

  for (const entry of entries) {
    if (problems.length >= 10) break;

    const pfadProblem = checkPath(entry.name);
    if (pfadProblem) {
      problems.push({ entry: entry.name || "(ohne Namen)", reason: pfadProblem });
      continue;
    }

    if (!ERLAUBTE_TYPEN.has(entry.type)) {
      const benennung = TYP_NAMEN[entry.type] ?? `Typ „${entry.type}“`;
      problems.push({
        entry: entry.name,
        reason:
          `${benennung} — erlaubt sind nur Dateien und Verzeichnisse. ` +
          (entry.linkname ? `Zeigt auf „${entry.linkname}“.` : ""),
      });
      continue;
    }

    totalBytes += entry.sizeBytes;
  }

  if (problems.length > 0) return { ok: false, problems };

  // Ein Archiv ohne echte Nutzdaten ist kein Backup, sondern ein
  // Löschbefehl: Das Einspielen räumt die Welt ab und schreibt nichts
  // zurück.
  //
  // Zweimal beim Durchspielen gegen den echten Agent aufgelaufen. Erst
  // mit `tar -czf x.tar.gz -C leer .`, das den Eintrag "./" enthält und
  // damit gültig aussieht. Und dann noch einmal, weil macOS in dasselbe
  // Archiv eine AppleDouble-Datei "._." legt — die zählte als Datei,
  // und der Server war wieder leer. Deshalb wird hier auf Dateien mit
  // Inhalt gezählt, und Metadateien der Betriebssysteme fallen heraus.
  const nutzdaten = entries.filter(
    (entry) =>
      entry.type !== "5" && entry.sizeBytes > 0 && !istMetadatei(entry.name),
  );

  if (nutzdaten.length === 0) {
    return {
      ok: false,
      problems: [
        {
          entry: "(Archiv)",
          reason:
            "Enthält keine Serverdaten — nur Verzeichnisse, leere Dateien " +
            "oder Beifang des Betriebssystems. Eingespielt würde es die Welt " +
            "löschen und nichts zurückschreiben.",
        },
      ],
    };
  }

  if (totalBytes > limits.maxTotalBytes) {
    return {
      ok: false,
      problems: [
        {
          entry: "(Archiv)",
          reason:
            `Entpackt ${Math.round(totalBytes / 1024 / 1024)} MB, der Server ` +
            `hat aber nur ${Math.round(limits.maxTotalBytes / 1024 / 1024)} MB.`,
        },
      ],
    };
  }

  return { ok: true, entries: entries.length, totalBytes };
}

/**
 * Sammelt die Einträge aus einem entpackten tar-Strom.
 *
 * Zwei Sonderfälle, die sonst ein Loch aufreißen: GNU tar legt Namen über
 * 100 Zeichen in einem eigenen Eintrag vom Typ "L" davor ab, pax-Archive
 * in einem vom Typ "x". Wer die überspringt, prüft den abgeschnittenen
 * Ersatznamen — und ein Angreifer schreibt seinen echten Pfad einfach
 * lang genug. Beide werden deshalb aufgelöst und der lange Name gilt.
 */
export class TarScanner {
  // Ohne den Typparameter wäre das ein Buffer<ArrayBuffer>, und die
  // Blöcke, die aus einem Strom kommen, passen dort nicht hinein.
  #rest: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  #übersprungen = 0;
  #langerName: string | null = null;

  readonly entries: TarEntry[] = [];

  /** Daten des laufenden Sonderheaders, solange er gesammelt wird. */
  #sonderTyp: string | null = null;
  #sonderDaten: Buffer[] = [];
  #sonderRest = 0;

  push(chunk: Buffer): void {
    this.#rest = this.#rest.length === 0 ? chunk : Buffer.concat([this.#rest, chunk]);

    while (this.#rest.length >= BLOCK_SIZE) {
      if (this.#übersprungen > 0) {
        const weg = Math.min(this.#übersprungen, this.#rest.length);
        this.#rest = this.#rest.subarray(weg);
        this.#übersprungen -= weg;
        continue;
      }

      if (this.#sonderRest > 0) {
        const weg = Math.min(this.#sonderRest, this.#rest.length);
        this.#sonderDaten.push(this.#rest.subarray(0, weg));
        this.#rest = this.#rest.subarray(weg);
        this.#sonderRest -= weg;

        if (this.#sonderRest === 0) this.#sonderAbschließen();
        continue;
      }

      const block = this.#rest.subarray(0, BLOCK_SIZE);
      this.#rest = this.#rest.subarray(BLOCK_SIZE);

      const entry = parseHeaderBlock(block);
      if (!entry) continue;

      const datenblöcke =
        Math.ceil(entry.sizeBytes / BLOCK_SIZE) * BLOCK_SIZE;

      if (entry.type === "L" || entry.type === "K" || entry.type === "x" || entry.type === "g") {
        // Namen stehen in den Daten dieses Eintrags, nicht im Header.
        this.#sonderTyp = entry.type;
        this.#sonderDaten = [];
        this.#sonderRest = datenblöcke;
        continue;
      }

      if (this.#langerName !== null) {
        entry.name = this.#langerName;
        this.#langerName = null;
      }

      this.entries.push(entry);
      this.#übersprungen = datenblöcke;
    }
  }

  #sonderAbschließen(): void {
    const roh = Buffer.concat(this.#sonderDaten).toString("utf8");
    this.#sonderDaten = [];

    if (this.#sonderTyp === "L") {
      // GNU-Langname: der reine Pfad, mit Nullbyte abgeschlossen.
      this.#langerName = roh.replace(/\0.*$/s, "");
    } else if (this.#sonderTyp === "x" || this.#sonderTyp === "g") {
      // pax: "<länge> path=<wert>\n". Nur der Pfad interessiert hier.
      const treffer = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(roh);
      if (treffer?.[1]) this.#langerName = treffer[1];
    }
    // "K" ist der Langname eines Verweisziels — Verweise fliegen ohnehin
    // raus, der Name des Eintrags selbst bleibt unberührt.

    this.#sonderTyp = null;
  }
}
