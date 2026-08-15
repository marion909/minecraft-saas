import net from "node:net";

/**
 * Server List Ping — das, was der Minecraft-Client macht, bevor er in der
 * Serverliste MOTD und Spielerzahl anzeigt.
 *
 * Für uns doppelt nützlich: Es ist der einzige Weg, das Hostname-Routing zu
 * prüfen, ohne DNS und ohne echten Client. Der Hostname, den wir im
 * Handshake mitschicken, ist genau der, den mc-router zum Weiterleiten liest.
 */

export function encodeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let rest = value >>> 0;

  do {
    let byte = rest & 0x7f;
    rest >>>= 7;
    if (rest !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (rest !== 0);

  return Buffer.from(bytes);
}

export function decodeVarInt(
  buffer: Buffer,
  offset = 0,
): { value: number; size: number } {
  let value = 0;
  let size = 0;

  for (;;) {
    if (offset + size >= buffer.length) {
      throw new Error("VarInt: Puffer zu kurz.");
    }

    const byte = buffer[offset + size]!;
    value |= (byte & 0x7f) << (7 * size);
    size += 1;

    if ((byte & 0x80) === 0) break;
    if (size > 5) throw new Error("VarInt: mehr als 5 Byte.");
  }

  return { value, size };
}

export function encodeString(text: string): Buffer {
  const body = Buffer.from(text, "utf8");
  return Buffer.concat([encodeVarInt(body.length), body]);
}

/** Packt Inhalt in ein Paket: Länge, Paket-ID, Rest. */
export function packet(id: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat([encodeVarInt(id), ...parts]);
  return Buffer.concat([encodeVarInt(body.length), body]);
}

export type PingResult = {
  motd: string;
  versionName: string;
  playersOnline: number;
  playersMax: number;
  raw: unknown;
};

export type PingOptions = {
  /** Wohin die TCP-Verbindung geht — in der Regel der Router. */
  host: string;
  port: number;
  /**
   * Der Hostname im Handshake. Danach entscheidet mc-router, an welchen
   * Server weitergeleitet wird — unabhängig davon, wohin die TCP-Verbindung
   * ging. Genau diese Trennung macht das Routing prüfbar.
   */
  serverAddress: string;
  protocolVersion?: number;
  timeoutMs?: number;
};

export function ping(options: PingOptions): Promise<PingResult> {
  const timeoutMs = options.timeoutMs ?? 8000;

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: options.host,
      port: options.port,
    });

    let buffer = Buffer.alloc(0);
    let settled = false;

    const finish = (error: Error | null, result?: PingResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve(result!);
    };

    socket.setTimeout(timeoutMs, () =>
      finish(new Error(`Ping-Zeitüberschreitung für ${options.serverAddress}.`)),
    );
    socket.once("error", (error) => finish(error));

    // Ohne diesen Zweig hinge der Aufruf für immer, wenn die Gegenseite
    // die Verbindung ohne Antwort schließt — genau das tut mc-router bei
    // einem Hostnamen, für den er keine Route kennt.
    socket.once("close", () =>
      finish(
        new Error(
          `Verbindung ohne Antwort geschlossen — keine Route für "${options.serverAddress}".`,
        ),
      ),
    );

    socket.once("connect", () => {
      const handshake = packet(
        0x00,
        encodeVarInt(options.protocolVersion ?? 767),
        encodeString(options.serverAddress),
        (() => {
          const port = Buffer.alloc(2);
          port.writeUInt16BE(options.port);
          return port;
        })(),
        encodeVarInt(1), // nächster Zustand: Status
      );

      socket.write(handshake);
      socket.write(packet(0x00)); // Status-Anfrage
    });

    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      try {
        const length = decodeVarInt(buffer, 0);
        const total = length.size + length.value;
        if (buffer.length < total) return;

        const id = decodeVarInt(buffer, length.size);
        if (id.value !== 0x00) {
          finish(new Error(`Unerwartete Paket-ID ${id.value}.`));
          return;
        }

        const jsonLength = decodeVarInt(buffer, length.size + id.size);
        const start = length.size + id.size + jsonLength.size;
        const json = buffer
          .subarray(start, start + jsonLength.value)
          .toString("utf8");

        const parsed = JSON.parse(json) as {
          description?: unknown;
          version?: { name?: string };
          players?: { online?: number; max?: number };
        };

        finish(null, {
          motd: flattenMotd(parsed.description),
          versionName: parsed.version?.name ?? "?",
          playersOnline: parsed.players?.online ?? 0,
          playersMax: parsed.players?.max ?? 0,
          raw: parsed,
        });
      } catch (error) {
        // Noch nicht genug Daten — auf den nächsten Chunk warten.
        if (error instanceof Error && error.message.includes("Puffer zu kurz")) {
          return;
        }
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

/** Die MOTD kommt je nach Server als Text, als Objekt oder als Baum. */
function flattenMotd(description: unknown): string {
  if (typeof description === "string") return description;
  if (!description || typeof description !== "object") return "";

  const node = description as { text?: string; extra?: unknown[] };
  const own = node.text ?? "";
  const children = Array.isArray(node.extra)
    ? node.extra.map(flattenMotd).join("")
    : "";

  return `${own}${children}`;
}
