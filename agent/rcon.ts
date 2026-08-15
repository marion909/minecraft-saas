import net from "node:net";

/**
 * Source-RCON, wie Minecraft es spricht. Klein genug, um es selbst zu halten:
 * vier Feldtypen, Little-Endian, nullterminierte Strings.
 *
 * Paketaufbau:
 *   int32 size   — Länge des Rests (ID + Typ + Body + zwei Nullbytes)
 *   int32 id     — frei wählbar, kommt in der Antwort zurück
 *   int32 type   — siehe PacketType
 *   body         — ASCII, nullterminiert
 *   byte 0       — abschließendes Nullbyte
 */

export const PacketType = {
  /** Antwort auf ein Kommando. */
  ResponseValue: 0,
  /** Kommando ausführen — und zugleich der Typ der Auth-Antwort. */
  Command: 2,
  /** Anmeldung mit dem Passwort. */
  Auth: 3,
} as const;

export type RconPacket = {
  id: number;
  type: number;
  body: string;
};

export function encodePacket(packet: RconPacket): Buffer {
  const body = Buffer.from(packet.body, "utf8");
  // id + type + body + zwei Nullbytes
  const size = 4 + 4 + body.length + 2;
  const buffer = Buffer.allocUnsafe(4 + size);

  buffer.writeInt32LE(size, 0);
  buffer.writeInt32LE(packet.id, 4);
  buffer.writeInt32LE(packet.type, 8);
  body.copy(buffer, 12);
  buffer.writeUInt8(0, 12 + body.length);
  buffer.writeUInt8(0, 13 + body.length);

  return buffer;
}

/**
 * Liest so viele vollständige Pakete wie möglich aus dem Puffer und gibt
 * den unverbrauchten Rest zurück. TCP liefert keine Nachrichtengrenzen,
 * ein Paket kann also über mehrere Chunks verteilt ankommen.
 */
export function decodePackets(buffer: Buffer<ArrayBufferLike>): {
  packets: RconPacket[];
  rest: Buffer<ArrayBufferLike>;
} {
  const packets: RconPacket[] = [];
  let offset = 0;

  while (buffer.length - offset >= 4) {
    const size = buffer.readInt32LE(offset);

    if (size < 10 || size > 4_096 + 16) {
      throw new Error(`RCON: unplausible Paketlänge ${size}.`);
    }
    if (buffer.length - offset - 4 < size) {
      break;
    }

    const id = buffer.readInt32LE(offset + 4);
    const type = buffer.readInt32LE(offset + 8);
    const body = buffer
      .subarray(offset + 12, offset + 4 + size - 2)
      .toString("utf8");

    packets.push({ id, type, body });
    offset += 4 + size;
  }

  return { packets, rest: buffer.subarray(offset) };
}

export type RconOptions = {
  host: string;
  port: number;
  password: string;
  timeoutMs?: number;
};

/**
 * Eine Verbindung, ein oder mehrere Kommandos, dann schließen. Für die
 * Konsole im Panel ist das ausreichend und deutlich robuster als eine
 * dauerhaft offene Verbindung, die bei jedem Serverneustart bricht.
 */
export class RconClient {
  #socket: net.Socket | null = null;
  #buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  #nextId = 1;
  #pending = new Map<
    number,
    { resolve: (body: string) => void; reject: (error: Error) => void }
  >();
  #chunks = new Map<number, string>();
  #auth: {
    id: number;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;

  // Ausgeschrieben statt als Parameter-Property: Node führt diese Dateien
  // direkt aus und strippt dabei nur Typen — Parameter-Properties erzeugen
  // aber Code und werden nicht unterstützt.
  private readonly options: RconOptions;

  constructor(options: RconOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    const timeoutMs = this.options.timeoutMs ?? 5000;

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({
        host: this.options.host,
        port: this.options.port,
      });

      const onError = (error: Error) => {
        socket.destroy();
        reject(error);
      };

      socket.setTimeout(timeoutMs, () => {
        onError(new Error(`RCON: Zeitüberschreitung beim Verbinden.`));
      });
      socket.once("error", onError);
      socket.once("connect", () => {
        socket.setTimeout(0);
        socket.off("error", onError);
        this.#socket = socket;
        socket.on("data", (chunk: Buffer) => this.#onData(chunk));
        socket.on("error", (error) => this.#failAll(error));
        socket.on("close", () => {
          // Nach einem angekündigten Abbruch ist das der Normalfall.
          if (this.#closing) return;
          this.#failAll(new Error("RCON: Verbindung geschlossen."));
        });
        resolve();
      });
    });

    await this.#authenticate();
  }

  /**
   * Die Anmeldung hat zwei Eigenheiten, die sie vom normalen Kommando
   * unterscheiden: Der Server schickt vorab ein leeres Paket vom Typ 0,
   * das übersprungen werden muss, und er signalisiert ein falsches Passwort
   * durch die ID -1 statt durch eine Fehlermeldung.
   */
  #authenticate(): Promise<void> {
    const id = this.#nextId++;
    const timeoutMs = this.options.timeoutMs ?? 5000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#auth = null;
        reject(new Error("RCON: keine Antwort auf die Anmeldung."));
      }, timeoutMs);

      this.#auth = {
        id,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };

      this.#socket?.write(
        encodePacket({ id, type: PacketType.Auth, body: this.options.password }),
      );
    });
  }

  async command(command: string): Promise<string> {
    if (!this.#socket) {
      throw new Error("RCON: nicht verbunden.");
    }
    const id = this.#nextId++;
    const response = await this.#send(id, PacketType.Command, command);
    return response ?? "";
  }

  /**
   * Schickt ein Kommando ab, ohne auf Antwort zu warten.
   *
   * Für genau einen Fall gedacht: `stop`. Der Server beantwortet ihn nicht
   * mehr, sondern fährt herunter und schließt die Verbindung. Wer hier auf
   * eine Antwort wartet, läuft immer in den Timeout und hält den sauberen
   * Weg fälschlich für gescheitert.
   */
  sendWithoutReply(command: string): Promise<void> {
    const socket = this.#socket;

    if (!socket) {
      throw new Error("RCON: nicht verbunden.");
    }

    // Auf den Flush warten ist hier wesentlich: write() puffert nur, und ein
    // unmittelbar folgendes destroy() würde das Paket verwerfen — der Server
    // bekäme sein "stop" nie zu sehen.
    return new Promise((resolve, reject) => {
      socket.write(
        encodePacket({
          id: this.#nextId++,
          type: PacketType.Command,
          body: command,
        }),
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  close(): void {
    // end() statt destroy(): schreibt Ausstehendes noch raus und schließt
    // danach ordentlich.
    this.#socket?.end();
    this.#socket = null;
  }

  #send(id: number, type: number, body: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const timeoutMs = this.options.timeoutMs ?? 5000;
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`RCON: keine Antwort auf Anfrage ${id}.`));
      }, timeoutMs);

      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this.#socket?.write(encodePacket({ id, type, body }));
    });
  }

  #onData(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);

    let decoded;
    try {
      decoded = decodePackets(this.#buffer);
    } catch (error) {
      this.#failAll(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    this.#buffer = decoded.rest;

    for (const packet of decoded.packets) {
      if (this.#auth) {
        // Das leere Vorab-Paket vom Typ 0 gehört noch zur Anmeldung.
        if (packet.type === PacketType.ResponseValue) continue;

        const auth = this.#auth;
        this.#auth = null;

        if (packet.id === -1) {
          auth.reject(
            new Error("RCON: Anmeldung abgelehnt — falsches Passwort."),
          );
        } else {
          auth.resolve();
        }
        continue;
      }

      const waiting = this.#pending.get(packet.id);

      if (!waiting) continue;

      if (packet.type === PacketType.ResponseValue) {
        // Lange Antworten kommen in mehreren Paketen mit gleicher ID.
        const merged = (this.#chunks.get(packet.id) ?? "") + packet.body;
        this.#chunks.set(packet.id, merged);

        // Ein einzelnes Paket fasst bis 4096 Byte; ist es kürzer, war es das.
        if (packet.body.length < 4000) {
          this.#chunks.delete(packet.id);
          this.#pending.delete(packet.id);
          waiting.resolve(merged);
        }
        continue;
      }

      this.#pending.delete(packet.id);
      waiting.resolve(packet.body);
    }
  }

  #failAll(error: Error): void {
    this.#auth?.reject(error);
    this.#auth = null;

    for (const waiting of this.#pending.values()) {
      waiting.reject(error);
    }
    this.#pending.clear();
    this.#chunks.clear();
  }

  /**
   * Ab hier ist ein Verbindungsabbruch erwartetes Verhalten und kein Fehler:
   * Nach `stop` fährt der Server herunter und schließt die Verbindung.
   */
  expectClose(): void {
    this.#closing = true;
  }

  #closing = false;

  get closing(): boolean {
    return this.#closing;
  }
}

/** Verbindet, führt die Kommandos der Reihe nach aus und schließt wieder. */
export async function withRcon<T>(
  options: RconOptions,
  handler: (client: RconClient) => Promise<T>,
): Promise<T> {
  const client = new RconClient(options);
  await client.connect();
  try {
    return await handler(client);
  } finally {
    client.close();
  }
}
