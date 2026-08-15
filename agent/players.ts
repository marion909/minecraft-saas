/**
 * Wertet die Antwort des `list`-Befehls aus.
 *
 * Vanilla und Paper antworten leicht unterschiedlich, und die Namensliste
 * fehlt, wenn niemand online ist:
 *
 *   "There are 0 of a max of 10 players online: "
 *   "There are 2 of a max of 20 players online: Steve, Alex"
 *   "There are 1 of a max of 5 players online (1 unique): Steve"
 */

export type PlayerList = {
  online: number;
  max: number;
  names: string[];
};

const HEADER = /There are (\d+) of a max(?:imum)? of (\d+) players online/i;

export function parsePlayerList(output: string): PlayerList {
  // Farbcodes entfernen, sonst landen sie in den Namen.
  const clean = output.replace(/§./g, "").trim();
  const header = HEADER.exec(clean);

  const online = header ? Number(header[1]) : 0;
  const max = header ? Number(header[2]) : 0;

  // Alles nach dem ersten Doppelpunkt ist die Namensliste.
  const separator = clean.indexOf(":");
  const names =
    separator === -1
      ? []
      : clean
          .slice(separator + 1)
          .split(",")
          .map((name) => name.trim())
          .filter((name) => name.length > 0);

  return { online, max, names };
}
