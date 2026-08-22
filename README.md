# Gameserver-Panel

Ein Webpanel, das auf eigener Hardware Spielserver betreibt. Jeder Nutzer
bekommt eigene Server als Docker-Container, Tarife setzen die Grenzen für
Arbeitsspeicher, CPU und Platte, ZFS erzwingt sie.

Gedacht für den, der einen Rechner hat und Server darauf betreiben will —
für Freunde, einen Verein, eine kleine Community. Kein Cloud-Dienst, keine
Anmeldung bei Dritten, keine laufenden Kosten außer Strom.

```bash
git clone https://github.com/marion909/minecraft-saas.git
cd minecraft-saas
sudo ./deploy/setup.sh
```

Ein Skript, rund fünfzehn Minuten, danach läuft es.

---

## Spiele

| Spiel | Adresse | RAM ab | Platte | Stand |
| --- | --- | --- | --- | --- |
| Minecraft (Java) | `<name>.mc.…` | 1,25 GB | 1 GB | im Dauerbetrieb |
| Terraria | `<name>.terraria.…:<port>` | 1 GB | 1 GB | gestartet und geprüft |
| Valheim | `<name>.valheim.…:<port>` | 4 GB | 4 GB | gestartet und geprüft |
| Satisfactory | `<name>.satisfactory.…:<port>` | 6 GB | 12 GB | gestartet und geprüft |
| Counter-Strike 2 | `<name>.cs2.…:<port>` | 2 GB | 32 GB | eingerichtet |
| Team Fortress 2 | `<name>.tf2.…:<port>` | 1 GB | 16 GB | eingerichtet |
| Garry's Mod | `<name>.gmod.…:<port>` | 2 GB | 10 GB | eingerichtet |
| Rust | `<name>.rust.…:<port>` | 8 GB | 20 GB | eingerichtet |
| Palworld | `<name>.palworld.…:<port>` | 8 GB | 8 GB | eingerichtet |
| 7 Days to Die | `<name>.7dtd.…:<port>` | 6 GB | 14 GB | eingerichtet |

**„Gestartet und geprüft"** heißt: Der Server wurde angelegt, ist hochgekommen
und hat von außen auf sein eigenes Protokoll geantwortet. **„Eingerichtet"**
heißt: Image, Ports und Datenverzeichnis stimmen, aber es hat noch niemand
laufen lassen. Rechne dort mit Nacharbeit.

Minecraft ist der Sonderfall: Alle Minecraft-Server teilen sich Port 25565,
und ein Router liest den Hostnamen aus dem Handshake, um den richtigen
Container zu finden. Jedes andere Spiel kennt kein solches Feld im Protokoll —
dort unterscheidet nur der Port, also bekommt jeder Server einen eigenen.
Deshalb steht bei allen anderen ein Port hinter der Adresse.

Ein neues Spiel ist ein Eintrag in [`src/lib/games.ts`](src/lib/games.ts):
Image, Ports, Datenverzeichnis, Speicherbedarf.

---

## Was Nutzer damit tun

**Server anlegen.** Spiel wählen, Name, Adresse, Tarif. Ob genug Kapazität
frei ist, wird vorher geprüft — nicht erst, wenn der Container schon läuft.

**Steuern.** Start, Stopp, Neustart. Bei Minecraft dazu eine RCON-Konsole.

**Zusehen.** Das Server-Log läuft live mit, daneben CPU- und
Speicherauslastung. Der Browser spricht dabei nie direkt mit dem Host.

**Dateien bearbeiten.** Verzeichnisse durchgehen, Textdateien ändern, Plugins
und Mods hochladen. Für `server.properties` gibt es einen geführten Editor
statt eines Textfelds.

**Sichern.** Auf ZFS als Snapshot in Sekunden, sonst als Archiv. Der Server
bleibt dabei erreichbar; er hält nur kurz das Schreiben an, damit die Welt
vollständig auf der Platte liegt. Ältere Sicherungen fallen nach der Grenze
des Tarifs weg.

**Herunterladen und einspielen.** Jede Sicherung lässt sich als `.tar.gz`
ziehen — auch vom ZFS-Node, wo sie als Snapshot liegt. Umgekehrt lässt sich
ein Archiv wieder einspielen, aus einer Sicherung auf der eigenen Platte oder
von einem fremden Server. Vor dem Einspielen legt das Panel selbst eine
Sicherung des aktuellen Standes an.

---

## Was Betreiber damit tun

**Konten anlegen.** Selbstregistrierung ist zu; ein Admin legt Konten an und
setzt Rollen. Löschen ist dreifach abgesichert: Es ist gesperrt, solange
Server am Konto hängen, fragt mit Name **und** Adresse nach — in einer Liste
mit zwei „Marion" ist der Name kein Unterscheidungsmerkmal — und das eigene
Konto lässt sich hier gar nicht löschen. Welten verschwinden nicht als
Nebenwirkung.

**Tarife festlegen.** RAM, CPU, Platte, Spielerzahl, Zahl der Server, Zahl der
Sicherungen. Die Liste zeigt zu jedem Tarif, wie oft er noch auf den Node
passt. Ein Tarif, auf dem Server laufen, lässt sich nicht löschen.

**Alle Server sehen.** Über alle Konten hinweg, mit Zustand und Besitzer.
Fremde Server sind im Panel als solche gekennzeichnet.

**Nodes verwalten.** Mehrere Hosts sind vorgesehen; ein neuer Server landet
auf dem Node mit dem meisten freien Arbeitsspeicher, auf den er passt.

**Den Host schalten.** Neustart und Herunterfahren aus dem Panel. Der Agent
hält vorher alle Server ordentlich an, damit keine Welt halb geschrieben
liegen bleibt.

---

## Voraussetzungen

| | |
| --- | --- |
| Betriebssystem | Ubuntu oder Debian, cgroup v2 |
| Arbeitsspeicher | ab 8 GB; davon bleiben rund 4 GB für System und Dienste |
| Platte | ein Blockgerät für ZFS — ganze Platte, Partition oder LVM-Volume |
| Netz | eine Domain und ein Router, in dem sich Ports weiterleiten lassen |

Eine feste IP ist nicht nötig, ein gewöhnlicher Anschluss reicht.

Der Pool braucht **kein eigenes Laufwerk**. Findet das Skript
unpartitionierten Platz oder freie LVM-Extents, bietet es an, eine Partition
daraus zu schneiden — genau der Fall nach einer Ubuntu-Standardinstallation,
wo der Installer das Wurzel-Volume deckelt und den Rest liegen lässt.

Ohne ZFS geht es auch (`SKIP_ZFS=1`), dann aber ohne harte Plattengrenzen und
mit Archiven statt Snapshots. Für einen Testlauf in Ordnung, für den Betrieb
nicht.

---

## Installation

```bash
git clone https://github.com/marion909/minecraft-saas.git
cd minecraft-saas
sudo ./deploy/setup.sh
```

Das Skript fragt nach Domain und E-Mail-Adresse, lässt das Gerät für ZFS
auswählen und erledigt den Rest: Pakete, ZFS-Pool, Docker, Firewall,
Dienstkonten, TLS über Caddy, Datenbank, Router und die beiden
systemd-Dienste. Jeder Schritt prüft, ob er schon erledigt ist — nach einem
Abbruch einfach erneut starten.

**Der eine gefährliche Schritt** ist der ZFS-Pool: Er löscht das gewählte
Gerät vollständig. Das Skript listet vorher alle Blockgeräte mit einem Urteil,
markiert das Wurzeldateisystem rot, weist Eingehängtes ab und verlangt, dass
`LOESCHEN` eingetippt wird.

Danach den ersten Admin anlegen — das Panel kann das nicht, die Anmeldung ist
ja zu:

```bash
cd /opt/mc-saas/app
sudo node scripts/create-admin.ts du@example.com "Dein Name"
```

Einzelheiten, der unbeaufsichtigte Modus und was bei nur einer Platte zu tun
ist: [deploy/README.md](deploy/README.md).

---

## Zwei Dinge kann kein Skript für dich tun

**DNS.** Für jedes Spiel, das du anbieten willst, ein Wildcard-Eintrag auf die
öffentliche IP, dazu einer für das Panel:

```
panel.example.com          A    <deine IP>
*.mc.example.com           A    <deine IP>
*.terraria.example.com     A    <deine IP>
*.valheim.example.com      A    <deine IP>
…
```

Läuft die Domain über Cloudflare, muss der Proxy für **alle** Einträge aus
sein (graue Wolke). Der Proxy versteht HTTP und HTTPS; Spielprotokolle kämen
nie an. Und mit Proxy vor `panel` erreicht Caddy die ACME-Prüfung nicht — das
Ergebnis ist ein Fehler 521.

**Portweiterleitung.** Im Router auf den Host:

| Port | Wofür |
| --- | --- |
| 80, 443 TCP | Panel und Zertifikate |
| 25565 TCP | alle Minecraft-Server gemeinsam |
| 27000–27099 TCP+UDP | ein Port je Server für alle anderen Spiele |

Ausdrücklich **nicht** weiterleiten: 22, 5432, 6379, 8080, 8787, 25575. Die
lauschen alle nur auf `127.0.0.1`. Eine Weiterleitung auf 8787 gäbe jedem im
Internet Root auf dem Host.

---

## Betrieb

Code aktualisieren, ohne den Host anzufassen:

```bash
sudo /opt/mc-saas/app/deploy/update.sh
```

Holt den aktuellen Stand, gleicht die Datenbank ans Schema an, baut das Panel
und startet es durch. Es sieht nach, was sich geändert hat, und macht nur das
Nötige. Braucht die Datenbank eine Bestätigung, fragt es — und bricht ab,
statt einen Build gegen ein altes Schema zu starten.

Zustand ansehen:

```bash
systemctl status mc-agent mc-panel
journalctl -u mc-panel -f
```

Ändert sich am **Host** etwas — neue Pakete, andere Kernel-Werte, ein zweiter
Pool —, dann wieder `setup.sh`. Die `.env` überschreibt es nicht.

---

## Sicherheit

Der Node-Agent hat vollen Zugriff auf Docker und ZFS. Er lauscht deshalb
ausschließlich auf `127.0.0.1:8787` und verlangt ein Token; das Panel spricht
über diesen einen Kanal mit ihm, der Browser nie direkt.

Zwei Dinge kann der Agent nicht selbst, weil sie Benutzer-ID 0 verlangen:
ZFS-Datasets einhängen und den Host schalten. Statt den ganzen Dienst zu
erheben, bekommen zwei kleine Skripte root über je eine eng gefasste
sudo-Regel — jede mit fester Verbliste und Pfadprüfung. Die Regel wird vor dem
Einsetzen mit `visudo -cf` geprüft, denn eine kaputte Datei unter
`/etc/sudoers.d` sperrt sudo für alle aus, auch für dich.

Container laufen mit `CapDrop: ALL` und bekommen nur zurück, was der Start
wirklich braucht. Kein Minecraft-Container veröffentlicht einen Port; Spieler
kommen ausschließlich über den Router herein.

Hochgeladene Archive werden vollständig geprüft, **bevor** ein Server
angefasst wird: keine Pfade mit `..`, keine absoluten Pfade, nur Dateien und
Verzeichnisse, und mindestens eine Datei mit Inhalt. Der letzte Punkt kommt
aus der Praxis — ein leeres Archiv kam zweimal durch die Prüfung und leerte
den Testserver.

Anmeldungen laufen nach sieben Tagen ab und verlängern sich bei Nutzung.

---

## Was fehlt

Ehrlich, weil es beim Einsatz zählt:

**Mailversand.** `MAIL_TRANSPORT` steht auf `console` — Bestätigungslinks
landen im Journal statt im Postfach. Für echte Nutzer ist ein Anbieter
einzutragen.

**Beitrittspasswörter.** Spiele mit eigenem Serverpasswort — Valheim etwa —
laufen derzeit mit der Vorgabe ihres Images. Wer die kennt, kommt auf jeden
öffentlich gelisteten Server. Bis das pro Server vergeben wird: von Hand
setzen.

**Erreichbarkeitsprüfung nur für Minecraft.** Bei anderen Spielen zeigt das
Panel den Zustand des Containers, nicht die Erreichbarkeit von außen.

**Sicherung außer Haus.** Snapshots liegen auf derselben Platte wie die Welt.
Sie schützen gegen Griefing und kaputte Plugins, nicht gegen einen
Plattenausfall. Ein nächtliches `zfs send` auf ein zweites Gerät ist von Hand
einzurichten.

**Version umstellen nur bei Minecraft.** Bei anderen Spielen lässt sich der
Container neu aufsetzen, die Version aber nicht wählen.

**Keine Abrechnung.** Tarife setzen Grenzen, sie kosten nichts.

---

## Entwicklung

```bash
pnpm install
pnpm db:generate && pnpm db:push && pnpm db:seed
pnpm dev
```

Braucht Node 23.6 oder neuer — der Agent läuft als TypeScript ohne
Bauschritt — sowie Postgres und Redis:

```bash
pnpm dev:services        # docker-compose.dev.yml
```

```bash
pnpm test        # 249 Fälle
pnpm typecheck
pnpm build
```

Die Tests decken ab, was still falsch sein kann: Kapazitätsrechnung, Wahl des
Nodes, Portvergabe, Prüfung hochgeladener Archive, Pfad-Schutz im
Dateimanager, Container-Baupläne über alle Spiele.

| Verzeichnis | Inhalt |
| --- | --- |
| `src/app` | Panel: Seiten und Server-Actions |
| `src/lib` | Fachlogik — Spielkatalog, Ports, Kapazität, Agent-Client |
| `agent/` | Node-Agent: Docker, ZFS, Backups, RCON |
| `deploy/` | Einrichtung, Aktualisierung, systemd, Compose |
| `prisma/` | Datenmodell |

Die drei Dokumente [PLAN.html](PLAN.html), [INSTALL.html](INSTALL.html) und
[HOST-SETUP.html](HOST-SETUP.html) beschreiben Architektur, Einrichtung und
Host-Runbook. Sie stammen vom 15.08.2026 und damit von vor dem Schritt zu
mehreren Spielen — die Grundlagen stimmen, die Spielauswahl fehlt darin.

Liegt die Arbeitskopie auf einer SMB-Freigabe, dauert `pnpm install` 10–20
Minuten (pnpm kann nicht hardlinken) und `dev`/`build` laufen mit `--webpack`
statt Turbopack, dessen Cache `fsync`-Semantik braucht, die SMB nicht
anbietet. Auf einer lokalen Platte kann der Flag ersatzlos weg.

---

## Lizenz

MIT — siehe [LICENSE](LICENSE).
