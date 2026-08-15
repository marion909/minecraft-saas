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
| 07 | `vm.swappiness=1`, `vm.max_map_count`, Verbindungsgrenzen |
| 08 | ufw: 22, 80, 443, 25565 — sonst nichts |
| 09 | SSH auf Schlüssel umstellen (nur wenn einer hinterlegt ist), fail2ban |
| 10 | Konten `mcagent` (Docker + ZFS) und `mcpanel`, `zfs allow` |
| 11 | Repo nach `/opt/mc-saas/app`, Abhängigkeiten |
| 12 | Geheimnisse erzeugen, `.env` schreiben, Node-Eckdaten berechnen |
| 13 | Prisma-Client, Panel bauen |
| 14 | Postgres, Redis, mc-router, Caddy starten |
| 15 | Schema schreiben, Node und Standardtarife anlegen |
| 16 | systemd-Dienste `mc-agent` und `mc-panel` |
| 17 | Abnahme, inklusive Prüfung auf ungewollt offene Container-Ports |

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
Geheimnisse bleiben. Zum Aktualisieren auf einen neuen Stand reicht:

```bash
sudo ./deploy/setup.sh
```

Das holt den aktuellen `main`, baut neu und startet die Dienste durch.

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
sudo -u mcpanel pnpm tsx scripts/promote-admin.ts DEINE@MAIL
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
