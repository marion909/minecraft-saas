#!/usr/bin/env bash
#
# Code aktualisieren, ohne den Host anzufassen.
#
#   sudo /opt/mc-saas/app/deploy/update.sh
#
# Das ist der kurze Weg für reine Code-Änderungen. Pakete, ZFS, Docker,
# Firewall, SSH und Dienstkonten bleiben unberührt — dafür ist setup.sh da.
#
# Das Skript schaut, was sich zwischen altem und neuem Stand geändert hat,
# und macht nur das Nötige: Abhängigkeiten nur bei geändertem Lockfile,
# Prisma nur bei geändertem Schema, Agent-Neustart nur bei Änderungen unter
# agent/. Der Panel-Build läuft immer, weil fast jede Änderung ihn betrifft.
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/mc-saas/app}"
BRANCH="${BRANCH:-main}"

if [ -t 1 ]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'
else
  B=""; G=""; Y=""; R=""; D=""; N=""
fi

ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
skip() { printf '  %s·%s %s\n' "$D" "$N" "$1"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$1"; }
die()  { printf '\n%sAbbruch:%s %s\n' "$R" "$N" "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Bitte mit sudo ausführen."
[ -d "$APP_DIR/.git" ] || die "$APP_DIR ist keine Arbeitskopie. Erstinstallation über deploy/setup.sh."

cd "$APP_DIR"

# Gleicht die Datenbank ans Schema an.
#
# Bewusst nicht an die touched-Prüfung gebunden: Der Abgleich kann von
# einem früheren Lauf offen sein — etwa weil er eine Bestätigung
# brauchte und abgebrochen wurde. Dann hätte sich schema.prisma seither
# nicht mehr geändert, und er käme nie wieder dran. `db push` meldet von
# selbst "already in sync", wenn nichts zu tun ist; das kostet nichts.
DB_GEAENDERT=0

datenbank_angleichen() {
  # Das Angleichen läuft hier und nicht als Hinweis zum Abtippen.
  # Grund: Die .env gehört root, weil Geheimnisse darin stehen — ein
  # `pnpm db:push` als gewöhnlicher Benutzer findet DATABASE_URL nicht
  # und meldet das als fehlende Variable. Dieses Skript läuft ohnehin
  # als root und im richtigen Verzeichnis.
  printf '\n%sDatenbank angleichen%s\n' "$B" "$N"

  push_log="$(mktemp)"

  # </dev/null ist hier tragend, nicht Kosmetik.
  #
  # Prisma prüft `process.stdin.isTTY`, um zu entscheiden, ob es bei
  # Warnungen selbst nachfragt. Hängt stdin am Terminal, stellt es die
  # Frage "Do you want to ignore the warning(s)?" — und die landete
  # zusammen mit stdout in der Logdatei. Sichtbar war nichts, das Skript
  # wartete auf die Antwort auf eine unsichtbare Frage.
  #
  # Ohne Terminal an stdin wirft Prisma stattdessen den Fehler mit
  # "Use the --accept-data-loss flag", den der Zweig unten abfängt. Die
  # Rückfrage stellt dann dieses Skript — sichtbar, mit den Warnungen
  # davor, und liest die Antwort von /dev/tty.
  if pnpm exec prisma db push >"$push_log" 2>&1 </dev/null; then
    if grep -q 'already in sync' "$push_log"; then
      skip "Datenbank war schon auf Stand"
    else
      ok "Schema übernommen"
      DB_GEAENDERT=1
    fi
  elif grep -q 'Use the --accept-data-loss flag' "$push_log"; then
    # Prisma verlangt eine Bestätigung. Sie gilt nicht nur echten
    # Verlusten: Eine neu hinzukommende Eindeutigkeitssperre zählt
    # auch dazu, obwohl sie nichts löscht — sie könnte nur an
    # vorhandenen Dubletten scheitern.
    printf '\n'
    # Alles ab der Überschrift zeigen — das sind die eigentlichen
    # Warnungen. Nur die Zeile mit dem Flag-Hinweis zu zeigen, hieße um
    # eine Bestätigung zu bitten, ohne zu sagen, wofür.
    sed -n '/There might be data loss/,$p' "$push_log" | sed 's/^/     /'
    printf '\n'
    warn "Prisma verlangt für die obigen Änderungen eine Bestätigung."

    if [ -t 0 ]; then
      read -r -p "     Übernehmen? [j/N]: " antwort </dev/tty
      case "$antwort" in
        j|J|y|Y)
          pnpm exec prisma db push --accept-data-loss >"$push_log" 2>&1 </dev/null \
            && { ok "Schema übernommen"; DB_GEAENDERT=1; } \
            || { sed -n 's/^/     /p' "$push_log"; die "Angleichen fehlgeschlagen."; }
          ;;
        *)
          # Hier wird abgebrochen und nicht weitergebaut. Der neue Code
          # erwartet Spalten, die es in der Datenbank nicht gibt — das
          # Panel beantwortete danach jede Seite mit einem Serverfehler.
          # Solange nichts gebaut und nichts neu gestartet wurde, läuft
          # der bisherige Build unverändert weiter.
          die "Abgleich abgelehnt — es wurde nichts gebaut, der laufende Build bleibt."
          ;;
      esac
    else
      die "Für die Rückfrage fehlt ein Terminal. Einmal von Hand: sudo $APP_DIR/deploy/update.sh"
    fi
  else
    sed -n 's/^/     /p' "$push_log"
    die "Angleichen fehlgeschlagen."
  fi

  rm -f "$push_log"

  if [ "$DB_GEAENDERT" = "1" ]; then
    # `prisma db push` erzeugt den Client seit Prisma 7 nicht mehr mit
    # (siehe `prisma db push --help`). Das Folgeskript lädt ihn aber —
    # mit einem Client von vor dem Abgleich kennt es die neuen Spalten
    # nicht.
    pnpm db:generate >/dev/null
  fi

  # Umstellungen, die dem Schema folgen. Jedes Skript prüft selbst, ob
  # es schon gelaufen ist, und tut sonst nichts.
  if [ -f "$APP_DIR/scripts/migrate-games.ts" ]; then
    node "$APP_DIR/scripts/migrate-games.ts" --tun 2>&1 | sed 's/^/     /'
  fi
}

printf '\n%sStand holen%s\n' "$B" "$N"
# UPDATE_VORHER setzt der Neustart weiter unten. Sonst ist der Startpunkt
# schlicht der aktuelle Stand.
before="${UPDATE_VORHER:-$(git rev-parse HEAD)}"
git fetch --quiet origin "$BRANCH"
git reset --hard --quiet "origin/$BRANCH"
after="$(git rev-parse HEAD)"

# Das Skript hat sich womöglich gerade selbst überschrieben.
#
# Bash liest eine Skriptdatei nicht auf einmal, sondern arbeitet sie
# fortlaufend ab und hält dabei den geöffneten Inode fest. `git reset`
# legt eine neue Datei an, statt die alte zu überschreiben — der offene
# Inode bleibt also gültig, und der Rest dieses Laufs stammt weiter aus
# der ALTEN Fassung. Die neue griffe erst beim nächsten Aufruf.
#
# Das ist keine Feinheit: Genau daran lag der kaputte Build. Die alte
# Fassung baute bei Schema-Änderungen einfach weiter und gab nur den
# Hinweis aus, die Datenbank sei noch anzugleichen. Danach lief neuer
# Code gegen alte Spalten, und das Panel beantwortete jede Seite mit
# einem Serverfehler.
if [ "${UPDATE_NEUGESTARTET:-0}" != "1" ] && [ "$before" != "$after" ] \
   && git diff --name-only "$before" "$after" | grep -qx 'deploy/update\.sh'; then
  warn "update.sh hat sich geändert — Neustart mit der neuen Fassung."
  export UPDATE_NEUGESTARTET=1 UPDATE_VORHER="$before"
  exec "$APP_DIR/deploy/update.sh"
fi

if [ "$before" = "$after" ]; then
  ok "Schon auf $(git rev-parse --short HEAD) — Code unverändert."
  changed=""
else
  changed="$(git diff --name-only "$before" "$after")"
  ok "$(git rev-parse --short "$before") → $(git rev-parse --short "$after"), $(printf '%s\n' "$changed" | grep -c .) Datei(en)"
fi

touched() { [ -n "$changed" ] && printf '%s\n' "$changed" | grep -qE "$1"; }

printf '\n%sBauen%s\n' "$B" "$N"

if touched '^pnpm-lock\.yaml$'; then
  pnpm install --frozen-lockfile --silent
  ok "Abhängigkeiten aktualisiert"
else
  skip "Lockfile unverändert"
fi

if touched '^prisma/schema\.prisma$'; then
  pnpm db:generate >/dev/null
  ok "Prisma-Client erzeugt"
else
  skip "Datenmodell unverändert"
fi


# Bewusst auch bei unverändertem Code: Ein Abgleich, der beim letzten Mal
# an einer Bestätigung hing, wäre sonst für immer offen.
datenbank_angleichen

# Weder neuer Code noch eine geänderte Datenbank — dann gibt es nichts zu
# bauen. Der Rest des Skripts ist ab hier nicht mehr umsonst.
if [ -z "$changed" ] && [ "$DB_GEAENDERT" != "1" ]; then
  printf '\n%s%sNichts zu tun.%s\n\n' "$B" "$G" "$N"
  exit 0
fi

if [ -z "$changed" ]; then
  warn "Code unverändert, aber die Datenbank wurde angeglichen — es wird gebaut."
fi

pnpm build >/dev/null
ok "Panel gebaut"

# Der Panel-Dienst schreibt in .next (Cache), der Rest bleibt lesbar.
chown -R root:mcsaas "$APP_DIR"
chmod -R g+rX "$APP_DIR"
chown -R mcpanel:mcsaas "$APP_DIR/.next"
ok "Rechte gesetzt"

printf '\n%sDienste%s\n' "$B" "$N"

if touched '^deploy/mc-(agent|panel)\.service$'; then
  install -m 0644 "$APP_DIR/deploy/mc-agent.service" /etc/systemd/system/
  install -m 0644 "$APP_DIR/deploy/mc-panel.service" /etc/systemd/system/
  systemctl daemon-reload
  ok "Unit-Dateien erneuert"
fi

if touched '^deploy/mc-zfs-helper$'; then
  install -m 0755 -o root -g root "$APP_DIR/deploy/mc-zfs-helper" /usr/local/sbin/mc-zfs-helper
  ok "mc-zfs-helper erneuert"
fi

# Bewusst ohne touched-Prüfung: Auf einer Installation von vor der
# Host-Steuerung gibt es weder das Skript noch die sudo-Regel. Ein Update
# darf die Funktion nicht halb ausgerollt liegen lassen — der Knopf im
# Panel wäre da, das Recht dahinter nicht.
install -m 0755 -o root -g root "$APP_DIR/deploy/mc-host-helper" /usr/local/sbin/mc-host-helper

sudoers=/etc/sudoers.d/mc-agent
if ! grep -qF '/usr/local/sbin/mc-host-helper' "$sudoers" 2>/dev/null; then
  cp -a "$sudoers" "$sudoers.neu" 2>/dev/null || : > "$sudoers.neu"
  printf 'mcagent ALL=(root) NOPASSWD: /usr/local/sbin/mc-host-helper\n' >> "$sudoers.neu"
  chmod 0440 "$sudoers.neu"
  # Eine kaputte Datei unter sudoers.d sperrt sudo für alle aus. Deshalb
  # erst prüfen, dann verschieben — nie direkt hineinschreiben.
  visudo -cf "$sudoers.neu" >/dev/null || { rm -f "$sudoers.neu"; die "sudoers-Regel ist ungültig."; }
  mv "$sudoers.neu" "$sudoers"
  ok "mc-host-helper installiert, sudo-Regel ergänzt"
else
  ok "mc-host-helper erneuert"
fi

if touched '^deploy/(docker-compose\.prod\.yml|Caddyfile)$'; then
  # --env-file, weil der Verweis deploy/.env erst seit einem bestimmten
  # Stand angelegt wird und hier nicht vorausgesetzt sein soll.
  (cd "$APP_DIR/deploy" && docker compose --env-file "$APP_DIR/.env" \
     -f docker-compose.prod.yml up -d >/dev/null 2>&1)
  ok "Infrastruktur-Container abgeglichen"
fi

# Die Firewall gehört eigentlich setup.sh. Diese eine Regel steht hier
# trotzdem: Ohne sie ist jeder Server außer Minecraft nach dem Update zwar
# angelegt und gestartet, aber von außen nicht erreichbar — und das sieht
# nach einem Fehler im Panel aus statt nach einer fehlenden Regel.
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "^Status: active"; then
  GAME_PORT_START="$(sed -n 's/^NODE_PORT_RANGE_START="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$APP_DIR/.env" | head -1)"
  GAME_PORT_END="$(sed -n 's/^NODE_PORT_RANGE_END="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$APP_DIR/.env" | head -1)"
  GAME_PORT_START="${GAME_PORT_START:-27000}"
  GAME_PORT_END="${GAME_PORT_END:-27099}"

  if ufw status | grep -q "${GAME_PORT_START}:${GAME_PORT_END}/tcp"; then
    skip "Spiel-Ports ${GAME_PORT_START}-${GAME_PORT_END} bereits offen"
  else
    ufw allow "${GAME_PORT_START}:${GAME_PORT_END}/tcp" >/dev/null
    ufw allow "${GAME_PORT_START}:${GAME_PORT_END}/udp" >/dev/null
    ok "Spiel-Ports ${GAME_PORT_START}-${GAME_PORT_END} geöffnet (TCP+UDP)"
    warn "Im Router müssen sie zusätzlich auf diesen Host weitergeleitet sein,"
    warn "sonst bleiben alle Spiele außer Minecraft im lokalen Netz."
  fi

  # Fehlt der Eintrag in der .env, kennt der Node-Datensatz den Bereich
  # womöglich auch nicht — dann stimmt die Firewall mit dem Panel nicht
  # überein und die Zuteilung läuft ins Leere.
  grep -q '^NODE_PORT_RANGE_START=' "$APP_DIR/.env" 2>/dev/null || {
    printf '\nNODE_PORT_RANGE_START="%s"\nNODE_PORT_RANGE_END="%s"\n' \
      "$GAME_PORT_START" "$GAME_PORT_END" >> "$APP_DIR/.env"
    ok "Portbereich in .env ergänzt"
  }
fi

systemctl restart mc-panel
ok "mc-panel neu gestartet"

# Nur wenn Agent-Code betroffen ist. Ein Neustart trennt keine Spieler —
# die Minecraft-Container laufen unabhängig weiter —, aber laufende
# Vorgänge wie ein Backup verlieren ihren Fortschrittsbericht.
#
# Bei leerem Diff ist unbekannt, was sich geändert hat — dann lieber
# neu starten. Sonst liefe der Agent mit Code von vor dem Abgleich
# gegen eine Datenbank, die schon das neue Schema hat.
if [ -z "$changed" ] || touched '^agent/'; then
  systemctl restart mc-agent
  ok "mc-agent neu gestartet (Agent-Code geändert)"
else
  skip "Agent unverändert, läuft weiter"
fi

sleep 3
systemctl is-active --quiet mc-panel || die "mc-panel läuft nicht — journalctl -u mc-panel -n 50"
systemctl is-active --quiet mc-agent || die "mc-agent läuft nicht — journalctl -u mc-agent -n 50"

printf '\n%s%sFertig.%s %s\n\n' "$B" "$G" "$N" "$(git log -1 --pretty='%s')"
