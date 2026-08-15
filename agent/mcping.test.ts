import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decodeVarInt,
  encodeString,
  encodeVarInt,
  packet,
} from "./mcping.ts";

describe("VarInt", () => {
  it("kodiert die Beispiele aus der Protokollspezifikation", () => {
    const cases: [number, number[]][] = [
      [0, [0x00]],
      [1, [0x01]],
      [127, [0x7f]],
      [128, [0x80, 0x01]],
      [255, [0xff, 0x01]],
      [25565, [0xdd, 0xc7, 0x01]],
      [2097151, [0xff, 0xff, 0x7f]],
    ];

    for (const [value, bytes] of cases) {
      assert.deepEqual(
        [...encodeVarInt(value)],
        bytes,
        `${value} falsch kodiert`,
      );
    }
  });

  it("dekodiert, was es kodiert hat", () => {
    for (const value of [0, 1, 127, 128, 300, 25565, 767, 2097151]) {
      const decoded = decodeVarInt(encodeVarInt(value));
      assert.equal(decoded.value, value);
      assert.equal(decoded.size, encodeVarInt(value).length);
    }
  });

  it("liest ab einem Versatz", () => {
    const buffer = Buffer.concat([encodeVarInt(5), encodeVarInt(25565)]);
    const second = decodeVarInt(buffer, 1);
    assert.equal(second.value, 25565);
  });

  it("meldet einen zu kurzen Puffer, statt Müll zu liefern", () => {
    // 0x80 heißt "es folgt noch ein Byte" — das aber fehlt.
    assert.throws(() => decodeVarInt(Buffer.from([0x80])), /zu kurz/);
  });

  it("bricht bei mehr als fünf Fortsetzungsbytes ab", () => {
    assert.throws(
      () => decodeVarInt(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80])),
      /5 Byte|zu kurz/,
    );
  });
});

describe("encodeString", () => {
  it("stellt die Länge in Bytes voran, nicht in Zeichen", () => {
    // "ä" ist ein Zeichen, aber zwei Byte in UTF-8.
    const encoded = encodeString("ä");
    assert.equal(decodeVarInt(encoded).value, 2);
  });

  it("kodiert einen Hostnamen vollständig", () => {
    const host = "panelprobe.mc.neuhauser.app";
    const encoded = encodeString(host);
    const length = decodeVarInt(encoded);
    assert.equal(
      encoded.subarray(length.size).toString("utf8"),
      host,
    );
  });
});

describe("packet", () => {
  it("stellt Gesamtlänge und Paket-ID voran", () => {
    const built = packet(0x00, encodeVarInt(767));
    const length = decodeVarInt(built, 0);

    assert.equal(length.value, built.length - length.size);
    assert.equal(decodeVarInt(built, length.size).value, 0x00);
  });

  it("erzeugt für die Status-Anfrage genau zwei Byte", () => {
    // Länge 1, Paket-ID 0 — das kürzestmögliche Minecraft-Paket.
    assert.deepEqual([...packet(0x00)], [0x01, 0x00]);
  });
});
