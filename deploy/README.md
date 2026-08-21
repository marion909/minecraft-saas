# Einrichtung auf dem Linux-Host

```bash
git clone https://github.com/marion909/minecraft-saas.git
cd minecraft-saas
sudo ./deploy/setup.sh
```

Das Skript fragt nach Domain und E-Mail, sucht das Gerät für ZFS aus und
erledigt danach alles Weitere. Rechne mit etwa 15 Minuten, das meiste davon
Downloads.

## Was es tut

| Schritt | Inhalt |
| --- | --- |
| 01 | Voraussetzungen: root, Ubuntu/Debian, cgroup v2, Hardware ermitteln |
| 02 | Domain, Panel-Hostname, Wildcard-Basis, ACME-Mail |
| 03 | Pakete, Node (mind. 23.6 — der Agent läuft als TypeScript), pnpm |
| 04 | **ZFS-Pool anlegen — löscht das gewählte Gerät** |
| 05 | ZFS-Cache deckeln, damit er den JVMs keinen Speicher wegnimmt |
| 06 | Docker, Log-Rotation, `live-restore`, Netz `mc-net` |
| 07 | `vm.swappiness=1`, `vm.max_map_count`, Verbindungsgrenzen, 8 GB Auslagerungsdatei |
| 08 | ufw: 22, 80, 443, 25565 und der Spiel-Portbereich — sonst nichts |
| 09 | SSH auf Schlüssel umstellen (nur wenn einer hinterlegt ist), fail2ban |
| 10 | Konten `mcagent` (Docker + ZFS) und `mcpanel`, `zfs allow` |
| 11 | Repo nach `/opt/mc-saas/app`, Abhängigkeiten |
| 12 | Geheimnisse erzeugen, `.env` schreiben, Node-Eckdaten berechnen |
| 13 | Prisma-Client, Panel bauen |
| 14 | Postgres, Redis, mc-router, Caddy starten |
| 15 | Schema schreiben, Node und Standardtarife anlegen |
| 16 | Helfer nach `/usr/local/sbin`, sudo-Regeln, systemd-Dienste `mc-agent` und `mc-panel` |
| 17 | Abnahme, inklusive Prüfung auf ungewollt offene Container-Ports |

### Ports für die anderen Spiele

Minecraft teilt sich 25565 über mc-router. Jedes andere Spiel unterscheidet
Server nur am Port, bekommt also einen eigenen aus `GAME_PORT_START` bis
`GAME_PORT_END` (Voreinstellung 27000–27099, TCP und UDP).

Zwei Dinge kann das Skript nicht:

**Portweiterleitung im Router.** Der Bereich muss auf diesen Host zeigen,
sonst bleiben die Server im lokalen Netz. Bei Minecraft ist es der eine Port
25565, hier sind es hundert.

**DNS je Spiel.** Für jedes angebotene Spiel ein Wildcard auf die öffentliche
IP — `*.cs2.example.com`, `*.valheim.example.com` und so weiter, alle ohne
Cloudflare-Proxy. Die Liste steht im Panel unter Admin → Nodes.

### Platz für eingespielte Backups

Ein hochgeladenes Archiv wird unter `${BACKUP_ROOT}/imports` zwischengelegt,
geprüft und nach dem Entpacken wieder entfernt. Es liegt dort also nur
während des Vorgangs — aber es liegt dort, und zwar zusätzlich zur Welt, die
gleich daraus entsteht. Auf einer knappen Platte ist das der Moment, in dem
sie überläuft. Die Obergrenze steht als `AGENT_MAX_IMPORT_MB` in der `.env`
(Voreinstellung 4096).

Bewusst nicht `/tmp`: Wo das ein tmpfs ist, ginge ein Weltarchiv in den
Arbeitsspeicher — auf einem Host, dessen RAM bis auf die Reserve an
Spielserver vergeben ist.

### Die beiden Helfer

Zwei Dinge kann der Agent nicht selbst, weil sie Benutzer-ID 0 verlangen:
ZFS-Datasets einhängen und den Host schalten. Statt den ganzen Dienst zu
erheben, bekommen zwei kleine Skripte root über je eine sudo-Regel:

| Skript | Verben | Grenzen |
| --- | --- | --- |
| `mc-zfs-helper` | `mount`, `destroy`, `rollback` | nur Datasets unter `…/mc/srv-`, keine Sonderzeichen, Einhängepunkt muss unter `/srv/mc` liegen |
| `mc-host-helper` | `reboot`, `poweroff` | genau ein Argument, sonst nichts |

Die Regeln landen in `/etc/sudoers.d/mc-agent` und werden vor dem
Verschieben mit `visudo -cf` geprüft — eine kaputte Datei dort sperrt sudo
für alle aus, auch für dich. Die Abnahme in Schritt 17 fragt beide Rechte
ab; beim Host-Helfer über `sudo -n -l`, das die Regel prüft, ohne den
Rechner neu zu starten.

## Der eine gefährliche Schritt

Schritt 04 legt den ZFS-Pool an und **löscht dabei das gewählte Gerät
vollständig**. Das Skript

- listet alle Blockgeräte mit einem Urteil, ob sie taugen,
- markiert das Wurzeldateisystem rot und alles Eingehängte gelb,
- weist eingehängte Geräte ab, auch wenn man sie von Hand einträgt,
- zeigt vor dem Löschen `lsblk` des Ziels,
- verlangt, dass `LOESCHEN` eingetippt wird.

Mit `SKIP_ZFS=1` lässt sich der Schritt auslassen. Dann fällt der Agent auf
einfache Verzeichnisse zurück — **ohne harte Speichergrenzen**, und
Sicherungen werden tar-Archive statt Snapshots. Für einen Testlauf in
Ordnung, für den Betrieb nicht.

## Nur eine Platte im Rechner

Der übliche Fall, und kein Problem: Der Pool braucht kein eigenes Laufwerk,
ein Blockgerät genügt. Findet das Skript keinen freien Kandidaten, sucht es
selbst nach Platz und bietet an, ihn herauszuschneiden:

- **Unpartitionierter Platz** am Ende einer GPT-Platte → es legt mit
  `sgdisk -n 0:0:0` eine Partition im größten freien Block an. Bestehende
  Partitionen kann das nicht berühren.
- **Freie Extents in einer Volume-Gruppe** → `lvcreate -l 100%FREE`. Genau
  der Fall nach einer Ubuntu-Standardinstallation: Der Installer deckelt
  das Wurzel-Volume und lässt den Rest der Gruppe liegen.

Ab 20 GB aufwärts wird gefragt. Das Herausschneiden selbst ist
unkritisch — es nimmt nur, was ohnehin niemandem gehört, und läuft deshalb
ohne `LOESCHEN`-Abfrage.

Ist die Platte dagegen restlos vergeben, bleibt nur, vorher Platz zu
schaffen: bei LVM `lvreduce` samt vorherigem `resize2fs`, sonst ein
`gparted` von einem Live-Stick. Oder neu installieren und der Wurzel von
vornherein weniger geben.

Wichtig zu wissen bei nur einer Platte: Die Snapshots liegen dann
zwangsläufig auf demselben Gerät wie die Welten. Sie schützen gegen
Griefing und kaputte Plugins, nicht gegen einen Plattenausfall. Das
`zfs send` auf ein zweites Gerät ist hier keine Kür.

## Unbeaufsichtigt

```bash
sudo DOMAIN=neuhauser.app \
     ACME_EMAIL=du@example.com \
     ZFS_DISK=/dev/disk/by-id/nvme-...-part4 \
     ASSUME_YES=1 \
     ./deploy/setup.sh
```

`ZFS_DISK` nimmt jedes Blockgerät: ganze Platte, Partition oder logisches
Volume.

`ASSUME_YES=1` übernimmt die Vorgaben und überspringt die
Löschbestätigung — nur einsetzen, wenn `ZFS_DISK` sicher stimmt. Ohne
`ZFS_DISK` schneidet das Skript in diesem Modus freien Platz ungefragt
heraus.

## Wiederholtes Ausführen

Jeder Schritt prüft, ob er schon erledigt ist. Nach einem Abbruch also
einfach erneut starten. Die `.env` wird dabei **nicht** überschrieben; die
Geheimnisse bleiben, und Domain, Hostnamen und ACME-Adresse liest das
Skript daraus zurück statt erneut zu fragen.

## Aktualisieren

Für reine Code-Änderungen — der Normalfall:

```bash
sudo /opt/mc-saas/app/deploy/update.sh
```

Holt den aktuellen `main`, baut das Panel und startet es durch. Den Host
fasst es nicht an: keine Pakete, kein ZFS, kein Docker, keine Firewall.

Es sieht nach, was sich geändert hat, und macht nur das Nötige:

| Geändert | Folge |
| --- | --- |
| `pnpm-lock.yaml` | `pnpm install` |
| `prisma/schema.prisma` | `pnpm db:generate`, dazu der Hinweis auf `db:push` |
| `agent/…` | `mc-agent` wird neu gestartet |
| `deploy/*.service` | Units erneuert, `daemon-reload` |
| `deploy/Caddyfile`, Compose | Container abgeglichen |
| `deploy/mc-zfs-helper` | Helfer erneuert |

Hat sich nichts geändert, bricht es sofort ab, statt sinnlos zu bauen.

Eine Ausnahme von dieser Regel ist `mc-host-helper`: Der wird bei jedem
Lauf installiert, und die sudo-Regel wird ergänzt, falls sie fehlt. Auf
einer Installation von vor der Host-Steuerung gibt es beides noch nicht —
und eine halb ausgerollte Funktion, bei der der Knopf im Panel da ist und
das Recht dahinter nicht, ist schlimmer als gar keine.

Wenn sich am **Host** etwas ändern soll — neue Pakete, andere
Kernel-Werte, ein zweiter Pool —, dann `setup.sh`:

```bash
sudo ./deploy/setup.sh
```

**Nicht von Hand bauen.** `pnpm` kommt von corepack, und corepack legt
seinen Cache unter `$HOME` an — für die Dienstkonten ist das
`/opt/mc-saas`, wo sie nicht schreiben dürfen. Ein `sudo -u mcpanel pnpm
build` scheitert also an `EACCES`. Gebaut wird als root, und danach muss
`.next` dem Panel gehören, weil `next start` dort seinen Cache schreibt.
Genau darum gibt es `update.sh`.

## Nach dem Skript

Zwei Dinge kann es nicht erledigen:

**DNS.** Zwei A-Einträge auf die öffentliche IP des Hosts:

```
panel.deine-domain      A
*.mc.deine-domain       A
```

**Portweiterleitung im Router.** 25565/TCP, 443/TCP, 80/TCP. Und
ausdrücklich *nicht* 22, 5432, 6379, 8080 oder 8787 — die lauschen alle nur
auf `127.0.0.1`, und eine Weiterleitung auf 8787 gäbe jedem im Internet Root
auf dem Host.

Danach registrieren. Der Bestätigungslink wird noch nicht verschickt, sondern
steht im Log:

```bash
journalctl -u mc-panel -f
```

Zum Admin machen:

```bash
cd /opt/mc-saas/app
sudo -u mcpanel node scripts/promote-admin.ts DEINE@MAIL
```

## Betrieb

```bash
systemctl status mc-agent mc-panel
journalctl -u mc-agent -f
cd /opt/mc-saas/app/deploy && docker compose -f docker-compose.prod.yml ps

# Kontrolle nach jedem Compose-Umbau: außer mc-router darf nirgends
# 0.0.0.0 stehen. Docker schreibt seine Regeln an ufw vorbei.
docker ps --format '{{.Names}} {{.Ports}}'
```

## Was noch fehlt

Der Mailversand steht auf `console` — Bestätigungslinks landen im Journal
statt im Postfach. Für den ersten echten Nutzer in `.env` einen Anbieter
eintragen.

Und das nächtliche `zfs send` auf die NAS ist noch von Hand einzurichten —
siehe oben, warum das keine Kür ist. Der Weg steht im Host-Runbook.
