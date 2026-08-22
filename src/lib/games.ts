/**
 * Welche Spiele dieses SaaS anbietet.
 *
 * Eine Quelle für beide Seiten: Das Panel baut daraus Auswahl, Adresse und
 * Kapazitätsprüfung, der Agent Image, Ports und Umgebung des Containers.
 * Ein neues Spiel ist im Idealfall ein Eintrag hier.
 *
 * Der wichtige Unterschied steckt in `routing`:
 *
 *   hostname — Minecraft. Der Client schickt den Hostnamen im Handshake
 *              mit, mc-router liest ihn und verteilt. Alle Server teilen
 *              sich einen Port, unterschieden werden sie am Namen.
 *
 *   port     — alles andere. Source-Spiele und die meisten übrigen laufen
 *              über UDP und haben kein Hostname-Feld im Protokoll; der
 *              Client verbindet zu IP:Port. Der DNS-Name ist dann nur
 *              Bequemlichkeit, unterschieden wird am Port. Jeder Server
 *              belegt deshalb einen eigenen.
 */

export type GameRouting = "hostname" | "port";
export type Transport = "tcp" | "udp" | "beide";

/**
 * Wie weit ein Spiel wirklich erprobt ist. Ehrlich benannt, weil der
 * Unterschied für den Betreiber zählt: „läuft hier seit Monaten“ ist
 * etwas anderes als „das Image existiert und die Eckdaten stimmen“.
 */
export type Reife = "erprobt" | "vorbereitet";

export type GameVariant = {
  id: string;
  label: string;
  hint?: string;
};

export type Game = {
  id: string;
  name: string;
  /** Segment in der Adresse: <server>.<slug>.<basis>. */
  slug: string;
  routing: GameRouting;
  transport: Transport;
  /** Port im Container. Bei `port`-Routing zusätzlich außen belegt. */
  gamePort: number;
  /** Weitere Ports, die das Spiel nach außen braucht (Query, Voice …). */
  extraPorts?: { port: number; transport: Transport; zweck: string }[];
  image: string;
  /**
   * Wohin im Container das Datenverzeichnis des Servers gehört.
   *
   * Der einzige Pfad, an dem etwas liegt, das nicht wiederherstellbar
   * ist. Alles andere im Container lädt sich notfalls neu; die Welt
   * nicht. Steht hier der falsche Pfad, läuft der Server trotzdem — nur
   * schreibt er in die Container-Schicht, und beim nächsten Ersetzen
   * des Containers ist alles weg. Auch die Sicherungen wären leer,
   * denn die schnappschussen das Dataset.
   *
   * Deshalb Pflichtfeld: Ein neues Spiel soll nicht mit dem Minecraft-
   * Pfad durchrutschen.
   */
  dataDir: string;
  /** Untergrenze, unterhalb derer der Server nicht sinnvoll läuft. */
  minMemoryMb: number;
  /** Grober Platzbedarf der Installation, ohne Welt. */
  installMb: number;
  reife: Reife;
  /** Steuerung über das Source-RCON-Protokoll (Minecraft nutzt dasselbe). */
  rcon: boolean;
  variants?: GameVariant[];
  hinweis?: string;
};

export const GAMES: Game[] = [
  {
    id: "minecraft",
    name: "Minecraft (Java)",
    slug: "mc",
    routing: "hostname",
    transport: "tcp",
    gamePort: 25565,
    image: "itzg/minecraft-server",
    /** Volumes und WorkingDir des Images. */
    dataDir: "/data",
    minMemoryMb: 1280,
    installMb: 1024,
    reife: "erprobt",
    rcon: true,
    variants: [
      { id: "PAPER", label: "Paper", hint: "Empfohlen: schnell, Plugins über Bukkit/Spigot." },
      { id: "VANILLA", label: "Vanilla", hint: "Original von Mojang, ohne Plugin-Unterstützung." },
      { id: "PURPUR", label: "Purpur", hint: "Paper mit zusätzlichen Einstellmöglichkeiten." },
      { id: "FABRIC", label: "Fabric", hint: "Für Fabric-Mods." },
      { id: "FORGE", label: "Forge", hint: "Für Forge-Modpacks." },
    ],
  },
  {
    id: "cs2",
    name: "Counter-Strike 2",
    slug: "cs2",
    routing: "port",
    transport: "udp",
    gamePort: 27015,
    extraPorts: [{ port: 27020, transport: "udp", zweck: "SourceTV" }],
    image: "joedwards32/cs2",
    /** STEAMCMDDIR und STEAMAPPDIR=/home/steam/cs2-dedicated.
     * Bewusst das Elternverzeichnis: Sonst lädt der Container die
     * 32 GB bei jedem Ersetzen erneut. */
    dataDir: "/home/steam",
    minMemoryMb: 2048,
    // Der Grund, warum CS2 auf einer 1-TB-Platte teuer ist: Die reine
    // Installation ist größer als zwanzig Minecraft-Welten.
    installMb: 32_768,
    reife: "vorbereitet",
    rcon: true,
    hinweis:
      "Die Installation lädt rund 32 GB über Steam und dauert beim ersten " +
      "Start entsprechend lange. Ein Game-Server-Login-Token (GSLT) von " +
      "Valve ist nötig, damit der Server öffentlich sichtbar ist.",
  },
  {
    id: "tf2",
    name: "Team Fortress 2",
    slug: "tf2",
    routing: "port",
    transport: "udp",
    gamePort: 27015,
    image: "cm2network/tf2",
    /** STEAMAPPDIR=/home/steam/tf-dedicated, daneben steamcmd. */
    dataDir: "/home/steam",
    minMemoryMb: 1024,
    installMb: 16_384,
    reife: "vorbereitet",
    rcon: true,
  },
  {
    id: "gmod",
    name: "Garry's Mod",
    slug: "gmod",
    routing: "port",
    transport: "udp",
    gamePort: 27015,
    image: "ich777/steamcmd:garrysmod",
    /** DATA_DIR=/serverdata, darunter steamcmd und serverfiles. */
    dataDir: "/serverdata",
    minMemoryMb: 2048,
    installMb: 10_240,
    reife: "vorbereitet",
    rcon: true,
  },
  {
    id: "valheim",
    name: "Valheim",
    slug: "valheim",
    routing: "port",
    transport: "udp",
    gamePort: 2456,
    extraPorts: [{ port: 2457, transport: "udp", zweck: "Abfrage" }],
    image: "lloesche/valheim-server",
    /** Die Welt liegt in /config/worlds_local. */
    dataDir: "/config",
    minMemoryMb: 4096,
    installMb: 4096,
    reife: "vorbereitet",
    rcon: false,
    hinweis: "Belegt zwei aufeinanderfolgende Ports.",
  },
  {
    id: "terraria",
    name: "Terraria",
    slug: "terraria",
    routing: "port",
    transport: "tcp",
    gamePort: 7777,
    image: "ryshe/terraria",
    /** Deklariertes Volume; dort landen Welt, config.json und die
     * TShock-Datenbank. Nachgemessen an einem laufenden Container. */
    dataDir: "/root/.local/share/Terraria/Worlds",
    minMemoryMb: 1024,
    installMb: 512,
    reife: "vorbereitet",
    rcon: false,
  },
  {
    id: "rust",
    name: "Rust",
    slug: "rust",
    routing: "port",
    transport: "udp",
    gamePort: 28015,
    extraPorts: [{ port: 28016, transport: "tcp", zweck: "RCON über Websocket" }],
    image: "didstopia/rust-server",
    /** Aus /app/*.sh: /steamcmd/rust/server/$RUST_SERVER_IDENTITY. */
    dataDir: "/steamcmd/rust",
    minMemoryMb: 8192,
    installMb: 20_480,
    reife: "vorbereitet",
    rcon: false,
    hinweis:
      "Braucht viel Arbeitsspeicher — unter 8 GB läuft eine gewachsene " +
      "Karte nicht mehr rund.",
  },
  {
    id: "palworld",
    name: "Palworld",
    slug: "palworld",
    routing: "port",
    transport: "udp",
    gamePort: 8211,
    image: "thijsvanloef/palworld-server-docker",
    /** Aus init.sh: /palworld/Pal/Saved. */
    dataDir: "/palworld",
    minMemoryMb: 8192,
    installMb: 8192,
    reife: "vorbereitet",
    rcon: true,
  },
  {
    id: "7dtd",
    name: "7 Days to Die",
    slug: "7dtd",
    routing: "port",
    // Als zwei Einträge bekam 26900 zwei verschiedene Außenports — einmal
    // UDP, einmal TCP. Ein Client verbindet sich aber zu einer Adresse
    // mit einer Nummer. "beide" hält sie zusammen.
    transport: "beide",
    gamePort: 26900,
    extraPorts: [
      { port: 26901, transport: "udp", zweck: "Spieldaten" },
      { port: 26902, transport: "udp", zweck: "Spieldaten" },
    ],
    image: "vinanrra/7dtd-server",
    /** Deckt die deklarierten Volumes ab: .local/share/7DaysToDie
     * für die Welt, serverfiles für die Installation. */
    dataDir: "/home/sdtdserver",
    minMemoryMb: 6144,
    installMb: 14_336,
    reife: "vorbereitet",
    rcon: true,
  },
  {
    id: "satisfactory",
    name: "Satisfactory",
    slug: "satisfactory",
    routing: "port",
    // 7777 trägt beides: das Spiel über UDP und die Server-API über TCP.
    // Letztere ist kein Zubehör — der Client fügt den Server über sie
    // hinzu und beansprucht ihn. Ohne TCP taucht er gar nicht erst auf.
    // Aus dem Serverlog: "Server API listening on '[::]:7777'".
    //
    // Der Nachrichtenport 8888 steht bewusst nicht dabei: Das Startskript
    // setzt ihn noch, aber der Server lauscht seit 1.0 nur auf 7777. Ein
    // Eintrag hier würde bloß einen Außenport verbrauchen.
    transport: "beide",
    gamePort: 7777,
    image: "wolveix/satisfactory-server",
    /** WorkingDir, und GAMECONFIGDIR zeigt nach /config/gamefiles. */
    dataDir: "/config",
    minMemoryMb: 6144,
    installMb: 12_288,
    reife: "vorbereitet",
    rcon: false,
  },
];

export const DEFAULT_GAME = "minecraft";

export function findGame(id: string): Game | undefined {
  return GAMES.find((game) => game.id === id);
}

export function gameOrThrow(id: string): Game {
  const game = findGame(id);
  if (!game) throw new Error(`Unbekanntes Spiel "${id}".`);
  return game;
}

/** Alle Adress-Segmente — gebraucht für die DNS-Einträge des Nodes. */
export function alleSlugs(): string[] {
  return [...new Set(GAMES.map((game) => game.slug))].sort();
}

/**
 * Die Adresse, die ein Spieler eintippt.
 *
 * Bei Minecraft genügt der Name — mc-router erkennt daran, wohin. Überall
 * sonst gehört der Port dazu, weil das Protokoll keinen Hostnamen kennt
 * und der Name allein nur zur IP des Hosts führt.
 */
export function serverAddress(
  game: Game,
  subdomain: string,
  baseDomain: string,
  port: number | null,
): string {
  const host = `${subdomain}.${game.slug}.${baseDomain}`;
  if (game.routing === "hostname") return host;
  return `${host}:${port ?? game.gamePort}`;
}

/** Nur der Name, ohne Port — für DNS und Routing-Tabellen. */
export function serverHostname(
  game: Game,
  subdomain: string,
  baseDomain: string,
): string {
  return `${subdomain}.${game.slug}.${baseDomain}`;
}
