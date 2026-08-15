# Minecraft-Server SaaS

Ein Admin legt Konten an, jedes Konto bekommt einen eigenen Minecraft-Server
als Docker-Container. Tarife bestimmen RAM-, CPU- und Speichergrenzen; ZFS
setzt sie als harte Quota durch.

**Läuft.** Panel unter `panel.neuhauser.app`, Server unter
`<name>.mc.neuhauser.app`, beides aus dem Internet erreichbar.

Die Planung liegt im Repo:

- `INSTALL.html` — Schritt für Schritt von der leeren Platte bis zum ersten Server
- `PLAN.html` — Architektur, Datenmodell, Sicherheit, Roadmap P0–P8
- `HOST-SETUP.html` — Runbook für den Linux-Host (Ubuntu, ZFS, Docker)

## Stand

**P0 — Fundament, abgeschlossen und gegen eine laufende Datenbank verifiziert.**
Durchgespielt: Konto → Anmelden → Dashboard, dazu die Rollenprüfung (ein
normaler Nutzer wird von `/admin` auf `/dashboard` umgeleitet), die
Shell-Skripte für die Admin-Rolle und die Kapazitätsanzeige. Der damals
enthaltene Weg über Registrierung und Bestätigungsmail ist inzwischen
abgeschaltet, siehe unten.

**P1 — Tarif-Verwaltung, abgeschlossen.** Anlegen, Bearbeiten und Löschen unter
`/admin/plans`, mit Validierung, Audit-Protokoll und Kapazitätsbezug: Die Liste
zeigt pro Tarif, wie oft er noch auf den Node passt. Löschen ist gesperrt,
solange Server darauf laufen.

**P2 — Node-Agent und Docker-Schicht, abgeschlossen.** Eigener Dienst unter
`agent/`, lauscht nur auf `127.0.0.1` mit Bearer-Token. Legt Container an,
startet, stoppt, sichert und entfernt sie. Gegen echtes Docker durchgespielt:
Ein Paper-Server wird provisioniert, wird steuerbar, beantwortet RCON-Befehle,
wird im laufenden Betrieb gesichert, sauber gestoppt und restlos entfernt.

**P3 — Server-Lebenszyklus im Panel, abgeschlossen.** Nutzer legen unter
`/servers/new` einen Server an: Name, Adresse, Tarif, Software, Version. Die
Kapazität des Nodes und das Serverlimit des Tarifs werden vorher geprüft. Die
Detailseite unter `/servers/:id` zeigt den Zustand, steuert Start/Stopp/Neustart
und bietet eine RCON-Konsole. Löschen verlangt, dass der Servername abgetippt
wird.

Der Zustand kommt bei jedem Seitenaufruf frisch vom Agent und wird in die
Datenbank zurückgeschrieben — die Spalte `status` ist Zwischenspeicher, nicht
Wahrheit.

**P4 — Erreichbarkeit, abgeschlossen.** mc-router läuft auf Port 25565 und
leitet anhand des Hostnamens aus dem Minecraft-Handshake an den richtigen
Container. Kein Server-Container veröffentlicht einen Port. Der Agent trägt
Routen beim Anlegen ein, entfernt sie beim Löschen und gleicht sie bei jedem
Start ab — der Router hält sie nur im Speicher.

Die Detailseite prüft die Adresse so, wie ein Minecraft-Client es tut, und
zeigt Spielerzahl, Version und MOTD.

Steht: `panel.neuhauser.app` und `*.mc.neuhauser.app` zeigen auf den Host,
Port 25565, 443 und 80 sind weitergeleitet.

Läuft die Domain über Cloudflare, muss der Proxy für **beide** Einträge aus
sein (graue Wolke). Der kostenlose Proxy versteht nur HTTP und HTTPS —
Minecraft ist rohes TCP und käme nie an. Und mit Proxy vor `panel` kommt
Caddy nicht an die ACME-Prüfung heran; das Ergebnis ist ein Fehler 521.

**P5 — Konsole und Live-Daten, abgeschlossen.** Die Detailseite zeigt das
Server-Log als fortlaufenden Stream und CPU- sowie Speicherauslastung als
Balken. Beides über Server-Sent Events; der Browser spricht nie direkt mit dem
Agent, sondern über einen Durchreicher im Panel, der vorher die
Eigentümerschaft prüft.

Docker bekommt genau einen Stats-Stream pro Container, egal wie viele Tabs
offen sind. Bricht der Browser ab, endet auch der Stream beim Agent.

**P6 — Dateimanager und Einstellungen, abgeschlossen.** Unter
`/servers/:id/files` lassen sich Verzeichnisse durchgehen, Textdateien
bearbeiten, Ordner anlegen und Dateien hochladen — Plugins nach `plugins/`,
Mods nach `mods/`. Unter `/servers/:id/settings` gibt es einen geführten
Editor für `server.properties`.

Der Pfad-Schutz ist der kritische Teil und entsprechend abgesichert
(`agent/paths.ts`, 18 Tests): `..` und absolute Pfade werden abgewiesen, und
jeder Pfad wird vor der Prüfung über `realpath` aufgelöst — sonst könnte ein
im Container angelegter Symlink aus dem Serververzeichnis herausführen.
Gegen einen echten `ln -s / /data/raus` im laufenden Container getestet.

`eula.txt` ist schreibgeschützt, und die RCON- und Port-Einstellungen in
`server.properties` lassen sich nicht ändern — über sie steuert das Panel
den Server.

**P7 — Backups, abgeschlossen.** Unter `/servers/:id/backups` lassen sich
Sicherungen anlegen, zurückspielen und löschen. Der Server bleibt beim
Sichern erreichbar — er hält nur kurz das Schreiben an, damit die Welt
vollständig auf der Platte liegt. Rotation nach `plan.maxBackups`: Ist das
Limit erreicht, verdrängt die neue Sicherung die älteste.

Zurückspielen stoppt den Server, spielt zurück und startet ihn wieder. Es
verlangt, dass der Servername abgetippt wird — alles seit der Sicherung geht
dabei verloren.

**Wechsel von Version und Server-Software** liegt unter
`/servers/:id/settings`. Der Container wird dabei ersetzt — Umgebungsvariablen
und Speichergrenzen schreibt Docker beim Anlegen fest und lassen sich nicht
nachträglich ändern. Welt, Plugins und Konfigurationsdateien liegen als
Bind-Mount außerhalb und bleiben unangetastet.

Rückstufungen und Software-Wechsel verlangen eine ausdrückliche Bestätigung
und weisen auf ein fehlendes Backup hin: Minecraft wandelt die Welt beim
Hochstufen um, und zurück führt kein unterstützter Weg.

**Konten-Verwaltung.** Die Selbstregistrierung ist abgeschaltet
(`disableSignUp`) — der Riegel sitzt am Endpunkt, nicht an der Seite. Konten
legt ein Admin unter `/admin/users` an; sie gelten sofort als bestätigt, es
gibt keine Mail. Rollenwechsel und Löschen in derselben Liste, mit drei
Sperren: nicht das eigene Konto, nicht der letzte Admin, und nicht solange
die Person Server hat — Welten sollen nicht als Nebenwirkung verschwinden.

Beim Anlegen eines Servers werden Name und Adresse **während des Tippens**
geprüft, nicht erst beim Abschicken. Namen sind je Nutzer eindeutig, ohne
Rücksicht auf Groß-/Kleinschreibung.

Noch nicht da: Abrechnung (P8).

## Agent

```bash
pnpm agent        # lauscht auf 127.0.0.1:8787
```

Endpunkte (alle mit `Authorization: Bearer $AGENT_TOKEN`):

| Methode | Pfad | Zweck |
| --- | --- | --- |
| GET | `/health` | Docker erreichbar, Speichertreiber, Netz |
| GET | `/servers` | alle verwalteten Container |
| POST | `/servers` | Speicher anlegen, Image ziehen, Container erstellen |
| GET | `/servers/:id` | Zustand, Bereitschaft, Belegung |
| POST | `/servers/:id/start` | starten und auf Steuerbarkeit warten |
| POST | `/servers/:id/stop` | Welt sichern, dann `docker stop` |
| POST | `/servers/:id/restart` | beides nacheinander |
| DELETE | `/servers/:id` | Container und Daten entfernen |
| POST | `/servers/:id/command` | RCON-Befehl absetzen |
| POST | `/servers/:id/backup` | Snapshot im laufenden Betrieb |
| GET | `/servers/:id/backups` | vorhandene Snapshots |
| GET | `/tasks/:id` | Fortschritt langer Vorgänge |

Lange Vorgänge liefern sofort einen Task zurück und laufen im Hintergrund;
der Fortschritt kommt über `/tasks/:id`. Die Task-Liste liegt nur im
Speicher — der wahre Zustand wird immer aus Docker gelesen.

### Speichertreiber

Auf dem Linux-Host mit ZFS-Pool: harte Quota pro Server, atomare Snapshots,
Rollback in Sekunden. Ohne ZFS (Entwicklungs-Mac) fällt der Agent auf einfache
Verzeichnisse zurück, warnt beim Start und meldet `hardQuota: false` — ein
Server kann dort seine Grenze überschreiten.

**Einhängen verlangt Benutzer-ID 0.** `zfs allow mount` deckt es unter Linux
nicht ab, und ambientes `CAP_SYS_ADMIN` genügt ZFS ebenfalls nicht — gemessen,
nicht vermutet. Der Agent ruft dafür `deploy/mc-zfs-helper` über eine
sudo-Regel auf: drei Verben, nur Datasets unterhalb von `…/mc/srv-`, und vor
dem `chown` die Prüfung, dass der Einhängepunkt wirklich unter `/srv/mc`
liegt. Die Dateiverwaltung — der einzige Teil, der Benutzereingaben in Pfade
übersetzt — bleibt unprivilegiert.

Zum Anlegen selbst braucht das Dienstkonto trotzdem `CAP_SYS_ADMIN`: ZFS
verlangt für `create` die mount-Fähigkeit als Voraussetzung, auch wenn das
Einhängen danach separat scheitert.

## Tests

```bash
pnpm test        # 143 Fälle: Kapazität, Pfad-Schutz, Validierung, Protokoll-Streams
pnpm typecheck
pnpm build
```

## Auf einem Linux-Host installieren

```bash
git clone https://github.com/marion909/minecraft-saas.git
cd minecraft-saas
sudo ./deploy/setup.sh
```

Richtet alles ein: ZFS-Pool, Docker, Firewall, Dienstkonten, TLS über Caddy,
mc-router, Datenbank und die beiden systemd-Dienste. Der Pool braucht keine
eigene Platte — findet das Skript unpartitionierten Platz oder freie
LVM-Extents, bietet es an, eine Partition daraus zu schneiden.

Danach den ersten Admin anlegen. Das Panel kann das nicht, die
Selbstregistrierung ist ja zu:

```bash
cd /opt/mc-saas/app
sudo node scripts/create-admin.ts du@example.com "Dein Name"
```

Für spätere Code-Änderungen der kurze Weg, der den Host nicht anfasst:

```bash
sudo /opt/mc-saas/app/deploy/update.sh
```

Einzelheiten, der unbeaufsichtigte Modus und was bei nur einer Platte zu tun
ist, stehen in [deploy/README.md](deploy/README.md).

## Entwicklung

### Voraussetzungen

- Node 23.6 oder neuer — Agent und Tests laufen als TypeScript direkt über
  Node, und erst ab dieser Version werden Typen ohne Flag gestrippt
- pnpm
- Docker (für Postgres und Redis)

### Einrichten

```bash
pnpm install

cp .env.example .env
# BETTER_AUTH_SECRET erzeugen und eintragen:
openssl rand -base64 32

# Postgres und Redis starten
pnpm dev:services

# Prisma-Client erzeugen und Schema in die Datenbank schreiben
pnpm db:generate
pnpm db:push

# Node und Standard-Tarife anlegen
pnpm db:seed

pnpm dev
```

`pnpm db:generate` muss nach jedem Klon und nach jeder Schema-Änderung laufen —
der erzeugte Client liegt unter `src/generated/` und ist nicht eingecheckt.

### Erstes Konto

Es gibt keine Registrierung, auch nicht in der Entwicklung. Das erste Konto
kommt über die Shell:

```bash
node scripts/create-admin.ts du@example.com "Dein Name"
```

Das Passwort steht danach einmal auf dem Schirm; mit `ADMIN_PASSWORD=…`
davor lässt sich eines vorgeben. Alle weiteren Konten dann im Panel unter
`/admin/users`.

Ein bestehendes Konto hochstufen:

```bash
node scripts/promote-admin.ts du@example.com
```

Beides bewusst über die Shell und nicht über das Panel — sonst wäre die
Admin-Rolle über die Anwendung selbst erreichbar.

Beide Skripte laufen direkt über Node, ohne `pnpm` und ohne `tsx`. Auf dem
Host ist das kein Komfort, sondern nötig: `pnpm` kommt von corepack, und
corepack legt seinen Cache unter `$HOME` an — für die Dienstkonten
`/opt/mc-saas`, wo sie nicht schreiben dürfen.

### Node-Werte

Die Werte stehen in `.env` und beschreiben die Zielhardware:

| Wert | Menge | Herleitung |
| --- | --- | --- |
| `NODE_TOTAL_MEMORY_MB` | 49152 | 48 GB verbaut |
| `NODE_RESERVED_MEMORY_MB` | 12288 | 6 GB ZFS-ARC + 2 GB OS + 4 GB Postgres/Redis/App/Agent |
| `NODE_TOTAL_CPU_CORES` | 12 | i5-12500, 6 Kerne / 12 Threads |
| `NODE_TOTAL_DISK_MB` | ~829000 | Rest der einzigen 1-TB-SSD nach 120 GB System, als ZFS-Pool `tank` |
| `NODE_RESERVED_DISK_MB` | ~166000 | 20 % Reserve, ZFS soll nicht über 85 % gefüllt werden |

Auf dem Host misst `deploy/setup.sh` diese Werte selbst und schreibt sie in
die `.env`; die Tabelle beschreibt nur, was dabei herauskommt.

Damit bleiben **36 GB für Server**, also neun Stück à 4 GB. RAM ist die
bindende Grenze — die neun Server belegen zusammen keine 100 GB Plattenplatz,
Platz ist also selbst auf einer einzelnen SSD nicht der Engpass.

## Aufbau

```
prisma/schema.prisma     Datenmodell (Auth, Plan, Node, Server, Backup, Audit)
prisma/seed.ts           Node und Standard-Tarife
scripts/create-admin.ts  Erstes Konto anlegen (das Panel kann es nicht)
scripts/promote-admin.ts Bestehendes Konto hochstufen
src/lib/auth.ts          better-auth, serverseitig
src/lib/session.ts       requireUser / requireAdmin für Seiten
src/lib/capacity.ts      Ressourcen-Buchhaltung, reine Funktionen
src/lib/env.ts           Prüfung der Umgebungsvariablen beim Start
src/app/(auth)/          Anmelden
src/app/(app)/           Dashboard und Admin, hinter Anmeldung
agent/                   Node-Agent: Docker, ZFS, RCON, Routing
agent/paths.ts           Pfad-Schutz des Dateimanagers, 18 Tests
deploy/                  setup.sh, update.sh, Units, Compose, Caddyfile
```

## Hinweis zum Arbeitsverzeichnis

Das Projekt liegt auf einer SMB-Freigabe. Daraus folgen zwei Dinge:

**`pnpm install` dauert 10–20 Minuten.** pnpm kann nicht hardlinken, weil sein
Store auf der lokalen Platte liegt und das Projekt auf der Freigabe. Jede Datei
wird einzeln über das Netz kopiert.

**`dev` und `build` laufen mit `--webpack` statt Turbopack.** Turbopacks
persistenter Cache braucht `fsync`-Semantik, die SMB nicht anbietet — der Build
bricht sonst mit `Operation not supported (os error 45)` ab. Der Flag steht
bereits in den Skripten; wenn das Projekt einmal auf einer lokalen Platte oder
auf dem Linux-Host liegt, kann er ersatzlos weg.

Falls `pnpm dev` Änderungen nicht bemerkt, hilft ein Neustart des Dev-Servers —
Dateiereignisse kommen über SMB nicht zuverlässig an.
