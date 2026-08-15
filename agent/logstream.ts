/**
 * Docker multiplext Container-Logs, wenn kein TTY zugewiesen ist — und das
 * ist bei uns der Fall. Jedem Ausgabestück geht ein 8-Byte-Kopf voran:
 *
 *   Byte 0    Strom: 0 = stdin, 1 = stdout, 2 = stderr
 *   Byte 1–3  immer 0
 *   Byte 4–7  Länge der Nutzdaten, Big Endian
 *
 * Wer den Kopf nicht abschneidet, bekommt Steuerzeichen mitten in der
 * Konsole — und je nach Zeichen zerlegt es die Darstellung im Browser.
 */

export type LogFrame = {
  stream: "stdout" | "stderr" | "stdin";
  text: string;
};

const STREAM_NAMES = ["stdin", "stdout", "stderr"] as const;

export class DockerLogDemuxer {
  #buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  /**
   * Nimmt ein beliebiges Stück des Streams entgegen und gibt die darin
   * vollständig enthaltenen Rahmen zurück. Angeschnittene Rahmen bleiben
   * gepuffert — TCP kennt keine Nachrichtengrenzen.
   */
  push(chunk: Buffer): LogFrame[] {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const frames: LogFrame[] = [];

    while (this.#buffer.length >= 8) {
      const type = this.#buffer[0]!;
      const length = this.#buffer.readUInt32BE(4);

      // Ein plausibler Kopf hat einen bekannten Stromtyp und drei Nullbytes.
      // Fehlt das, wurde der Container mit TTY gestartet und es gibt gar
      // keine Rahmen — dann alles als Text durchreichen.
      const looksFramed =
        type <= 2 &&
        this.#buffer[1] === 0 &&
        this.#buffer[2] === 0 &&
        this.#buffer[3] === 0;

      if (!looksFramed) {
        frames.push({ stream: "stdout", text: this.#buffer.toString("utf8") });
        this.#buffer = Buffer.alloc(0);
        break;
      }

      if (this.#buffer.length < 8 + length) break;

      frames.push({
        stream: STREAM_NAMES[type] ?? "stdout",
        text: this.#buffer.subarray(8, 8 + length).toString("utf8"),
      });

      this.#buffer = this.#buffer.subarray(8 + length);
    }

    return frames;
  }

  /** Was am Ende noch im Puffer liegt — beim Schließen des Streams. */
  flush(): string {
    const rest = this.#buffer.toString("utf8");
    this.#buffer = Buffer.alloc(0);
    return rest;
  }
}

/**
 * Zerlegt Rahmen in einzelne Zeilen. Ein Rahmen kann mehrere Zeilen
 * enthalten oder mitten in einer enden, deshalb wird der Rest gehalten.
 */
export class LineAssembler {
  #partial = "";

  push(text: string): string[] {
    const combined = this.#partial + text;
    const parts = combined.split(/\r?\n/);

    // Das letzte Stück ist nur dann eine fertige Zeile, wenn der Text
    // mit einem Zeilenumbruch endete.
    this.#partial = parts.pop() ?? "";
    return parts;
  }

  flush(): string[] {
    if (!this.#partial) return [];
    const rest = this.#partial;
    this.#partial = "";
    return [rest];
  }
}

/**
 * Minecraft-Logzeilen tragen einen Zeitstempel und die Stufe im Kopf.
 * Für die Anzeige reicht das Erkennen der Stufe — Fehler sollen sich
 * abheben, ohne dass der Browser den ganzen Text parsen muss.
 */
export type LogLevel = "info" | "warn" | "error";

export function levelOf(line: string): LogLevel {
  if (/\b(ERROR|SEVERE|FATAL)\b/.test(line)) return "error";
  if (/\bWARN(ING)?\b/.test(line)) return "warn";
  return "info";
}
