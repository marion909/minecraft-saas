import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DockerLogDemuxer,
  LineAssembler,
  levelOf,
} from "./logstream.ts";
import { parsePlayerList } from "./players.ts";
import { computeSample } from "./stats.ts";

/** Baut einen Docker-Rahmen: 8-Byte-Kopf plus Nutzdaten. */
function frame(stream: 1 | 2, text: string): Buffer {
  const body = Buffer.from(text, "utf8");
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

describe("DockerLogDemuxer", () => {
  it("schneidet den 8-Byte-Kopf ab", () => {
    const demuxer = new DockerLogDemuxer();
    const frames = demuxer.push(frame(1, "Hallo Welt\n"));

    assert.equal(frames.length, 1);
    assert.equal(frames[0]?.text, "Hallo Welt\n");
    assert.equal(frames[0]?.stream, "stdout");
  });

  it("unterscheidet stdout und stderr", () => {
    const demuxer = new DockerLogDemuxer();
    const frames = demuxer.push(
      Buffer.concat([frame(1, "normal"), frame(2, "fehler")]),
    );

    assert.deepEqual(
      frames.map((f) => f.stream),
      ["stdout", "stderr"],
    );
  });

  it("hält einen angeschnittenen Rahmen zurück", () => {
    const demuxer = new DockerLogDemuxer();
    const full = frame(1, "eine vollständige Zeile");

    // Erst die Hälfte …
    assert.deepEqual(demuxer.push(full.subarray(0, 12)), []);
    // … dann der Rest.
    const frames = demuxer.push(full.subarray(12));
    assert.equal(frames[0]?.text, "eine vollständige Zeile");
  });

  it("verkraftet einen Kopf, der über zwei Chunks verteilt ankommt", () => {
    const demuxer = new DockerLogDemuxer();
    const full = frame(1, "kurz");

    assert.deepEqual(demuxer.push(full.subarray(0, 3)), []);
    const frames = demuxer.push(full.subarray(3));
    assert.equal(frames[0]?.text, "kurz");
  });

  it("reicht Daten ohne Rahmen unverändert durch", () => {
    // Container mit TTY liefern keinen Kopf. Ohne diese Erkennung
    // würden die ersten acht Zeichen der Ausgabe verschluckt.
    const demuxer = new DockerLogDemuxer();
    const frames = demuxer.push(Buffer.from("Klartext ohne Kopf", "utf8"));

    assert.equal(frames[0]?.text, "Klartext ohne Kopf");
  });

  it("verkraftet mehrere Rahmen in einem Chunk", () => {
    const demuxer = new DockerLogDemuxer();
    const frames = demuxer.push(
      Buffer.concat([frame(1, "eins\n"), frame(1, "zwei\n"), frame(1, "drei\n")]),
    );
    assert.equal(frames.length, 3);
  });
});

describe("LineAssembler", () => {
  it("gibt nur abgeschlossene Zeilen heraus", () => {
    const lines = new LineAssembler();
    assert.deepEqual(lines.push("eins\nzwei\ndr"), ["eins", "zwei"]);
    assert.deepEqual(lines.push("ei\n"), ["drei"]);
  });

  it("behandelt CRLF wie LF", () => {
    const lines = new LineAssembler();
    assert.deepEqual(lines.push("eins\r\nzwei\r\n"), ["eins", "zwei"]);
  });

  it("gibt den Rest beim Schließen heraus", () => {
    const lines = new LineAssembler();
    lines.push("ohne Umbruch");
    assert.deepEqual(lines.flush(), ["ohne Umbruch"]);
  });
});

describe("levelOf", () => {
  it("erkennt Warnungen und Fehler", () => {
    assert.equal(levelOf("[12:00:00] [Server thread/INFO]: Alles gut"), "info");
    assert.equal(levelOf("[12:00:00] [Server thread/WARN]: Achtung"), "warn");
    assert.equal(levelOf("[12:00:00] [Server thread/ERROR]: Kaputt"), "error");
  });
});

describe("computeSample", () => {
  it("rechnet die CPU-Zähler in Prozent um", () => {
    const sample = computeSample({
      cpu_stats: {
        cpu_usage: { total_usage: 2_000_000 },
        system_cpu_usage: 20_000_000,
        online_cpus: 4,
      },
      precpu_stats: {
        cpu_usage: { total_usage: 1_000_000 },
        system_cpu_usage: 10_000_000,
      },
      memory_stats: { usage: 0, limit: 0 },
    });

    // 1e6 / 1e7 * 4 * 100 = 40
    assert.equal(sample.cpuPercent, 40);
  });

  it("meldet bei der ersten Messung 0 statt NaN", () => {
    // Ohne Vorgängerwerte ist die Differenz null — hier entsteht sonst
    // eine Division durch null.
    const sample = computeSample({
      cpu_stats: { cpu_usage: { total_usage: 5 }, system_cpu_usage: 5 },
      precpu_stats: {},
      memory_stats: { usage: 100, limit: 200 },
    });

    assert.equal(sample.cpuPercent, 0);
  });

  it("zieht den Dateicache vom Speicher ab", () => {
    // Sonst sähe jede JVM, die viel liest, dauerhaft wie am Limit aus.
    const sample = computeSample({
      memory_stats: {
        usage: 1000,
        limit: 2000,
        stats: { inactive_file: 400 },
      },
    });

    assert.equal(sample.memoryBytes, 600);
    assert.equal(sample.memoryPercent, 30);
  });

  it("kommt mit cgroup v1 zurecht, das den Cache anders nennt", () => {
    const sample = computeSample({
      memory_stats: { usage: 1000, limit: 2000, stats: { cache: 250 } },
    });
    assert.equal(sample.memoryBytes, 750);
  });
});

describe("parsePlayerList", () => {
  it("liest Anzahl und Namen", () => {
    const list = parsePlayerList(
      "There are 2 of a max of 20 players online: Steve, Alex",
    );
    assert.deepEqual(list, { online: 2, max: 20, names: ["Steve", "Alex"] });
  });

  it("kommt mit leerer Liste zurecht", () => {
    const list = parsePlayerList(
      "There are 0 of a max of 10 players online: ",
    );
    assert.deepEqual(list, { online: 0, max: 10, names: [] });
  });

  it("entfernt Farbcodes aus den Namen", () => {
    const list = parsePlayerList(
      "§fThere are 1 of a max of 5 players online: §aSteve",
    );
    assert.deepEqual(list.names, ["Steve"]);
  });
});
