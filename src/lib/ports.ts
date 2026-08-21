import type { Game } from "./games.ts";

/**
 * Portvergabe für Spiele ohne Hostname-Routing.
 *
 * Minecraft kommt ohne das aus: Alle Server hängen an 25565, mc-router
 * verteilt sie am Hostnamen. Bei allem anderen unterscheidet nur der Port,
 * also braucht jeder Server einen eigenen — und zwei Server dürfen nie
 * denselben bekommen, sonst startet der zweite nicht und der erste ist
 * plötzlich für fremde Spieler erreichbar.
 *
 * Reine Funktionen, weil die Regel wehtut, wenn sie falsch ist, und sich
 * so ohne Datenbank prüfen lässt.
 */

/** Wie viele aufeinanderfolgende Ports ein Server dieses Spiels belegt. */
export function blockSize(game: Game): number {
  return 1 + (game.extraPorts?.length ?? 0);
}

export type PortRange = { start: number; end: number };

export type Allocation =
  | { ok: true; port: number; belegt: number[] }
  | { ok: false; reason: string };

/**
 * Sucht den niedrigsten freien Block im Bereich.
 *
 * Von unten statt zufällig: Nach dem Löschen eines Servers wird die Lücke
 * wieder gefüllt, statt dass der Bereich nach oben davonläuft. Und wer die
 * Firewall-Regeln liest, sieht zusammenhängende Nummern statt Streusel.
 */
export function allocatePort(
  vergeben: number[],
  range: PortRange,
  größe: number,
): Allocation {
  if (größe < 1) {
    return { ok: false, reason: "Ein Server belegt mindestens einen Port." };
  }

  if (range.end < range.start) {
    return {
      ok: false,
      reason: `Portbereich ${range.start}–${range.end} ist verkehrt herum.`,
    };
  }

  const besetzt = new Set(vergeben);

  for (let kandidat = range.start; kandidat + größe - 1 <= range.end; kandidat += 1) {
    let frei = true;

    for (let versatz = 0; versatz < größe; versatz += 1) {
      if (besetzt.has(kandidat + versatz)) {
        frei = false;
        // Direkt hinter den Störer springen statt Schritt für Schritt:
        // Bei einem vollen Bereich spart das die quadratische Suche.
        kandidat += versatz;
        break;
      }
    }

    if (frei) {
      return {
        ok: true,
        port: kandidat,
        belegt: Array.from({ length: größe }, (_, i) => kandidat + i),
      };
    }
  }

  return {
    ok: false,
    reason:
      `Im Bereich ${range.start}–${range.end} ist kein Block von ${größe} ` +
      `zusammenhängenden Ports mehr frei. ${vergeben.length} sind vergeben.`,
  };
}

/**
 * Welche Ports ein Server insgesamt belegt — der zugeteilte plus die
 * Zusatzports des Spiels, in derselben Reihenfolge wie im Katalog.
 */
export function portsOf(game: Game, basis: number): number[] {
  return Array.from({ length: blockSize(game) }, (_, i) => basis + i);
}

/**
 * Bildet Container-Ports auf Host-Ports ab.
 *
 * Im Container behält das Spiel seine gewohnten Nummern — es lässt sich
 * meist gar nicht umkonfigurieren. Nach außen liegt es auf dem Block,
 * den es bekommen hat.
 */
export type PortMapping = {
  containerPort: number;
  hostPort: number;
  transport: "tcp" | "udp";
};

export function portMappings(game: Game, basis: number): PortMapping[] {
  const mappings: PortMapping[] = [];

  const füge = (containerPort: number, hostPort: number, transport: string) => {
    // "beide" heißt: dieselbe Nummer einmal als TCP und einmal als UDP.
    for (const art of transport === "beide" ? ["tcp", "udp"] : [transport]) {
      mappings.push({
        containerPort,
        hostPort,
        transport: art as "tcp" | "udp",
      });
    }
  };

  füge(game.gamePort, basis, game.transport);

  game.extraPorts?.forEach((extra, index) => {
    füge(extra.port, basis + index + 1, extra.transport);
  });

  return mappings;
}
