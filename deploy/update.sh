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

printf '\n%sStand holen%s\n' "$B" "$N"
before="$(git rev-parse HEAD)"
git fetch --quiet origin "$BRANCH"
git reset --hard --quiet "origin/$BRANCH"
after="$(git rev-parse HEAD)"

if [ "$before" = "$after" ]; then
  ok "Schon auf $(git rev-parse --short HEAD) — nichts zu tun."
  exit 0
fi

changed="$(git diff --name-only "$before" "$after")"
ok "$(git rev-parse --short "$before") → $(git rev-parse --short "$after"), $(printf '%s\n' "$changed" | grep -c .) Datei(en)"

touched() { printf '%s\n' "$changed" | grep -qE "$1"; }

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
  # Bewusst laut: db:push gleicht die Datenbank ans Schema an und kann
  # dabei Spalten entfernen. Bei einer entfernten Spalte sind deren Daten
  # weg, und niemand fragt vorher.
  warn "Schema geändert — Datenbank angleichen mit: cd $APP_DIR && pnpm db:push"
else
  skip "Datenmodell unverändert"
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

systemctl restart mc-panel
ok "mc-panel neu gestartet"

# Nur wenn Agent-Code betroffen ist. Ein Neustart trennt keine Spieler —
# die Minecraft-Container laufen unabhängig weiter —, aber laufende
# Vorgänge wie ein Backup verlieren ihren Fortschrittsbericht.
if touched '^agent/'; then
  systemctl restart mc-agent
  ok "mc-agent neu gestartet (Agent-Code geändert)"
else
  skip "Agent unverändert, läuft weiter"
fi

sleep 3
systemctl is-active --quiet mc-panel || die "mc-panel läuft nicht — journalctl -u mc-panel -n 50"
systemctl is-active --quiet mc-agent || die "mc-agent läuft nicht — journalctl -u mc-agent -n 50"

printf '\n%s%sFertig.%s %s\n\n' "$B" "$G" "$N" "$(git log -1 --pretty='%s')"
