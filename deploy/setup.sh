#!/usr/bin/env bash
#
# Vollständige Einrichtung eines Minecraft-SaaS-Hosts auf Ubuntu.
#
#   sudo ./deploy/setup.sh
#
# Das Skript ist wiederholbar: Jeder Schritt prüft zuerst, ob er schon
# erledigt ist. Ein Abbruch mittendrin lässt sich also durch erneutes
# Ausführen fortsetzen.
#
# Genau ein Schritt ist unwiderruflich — das Anlegen des ZFS-Pools löscht
# die gewählte Platte. Er fragt ausdrücklich nach und lässt sich mit
# SKIP_ZFS=1 überspringen.
#
# Steuerung über Umgebungsvariablen (sonst wird interaktiv gefragt):
#   DOMAIN=neuhauser.app  PANEL_HOST=panel.neuhauser.app
#   MC_HOST=mc.neuhauser.app  ACME_EMAIL=du@example.com
#   ZFS_DISK=/dev/disk/by-id/…   ASSUME_YES=1
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Grundeinstellungen
# ---------------------------------------------------------------------------
REPO_URL="${REPO_URL:-https://github.com/marion909/minecraft-saas.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/mc-saas/app}"
ENV_FILE="$APP_DIR/.env"
DATA_ROOT="/srv/mc"
BACKUP_ROOT="/srv/backups"
ZFS_POOL="${ZFS_POOL:-tank}"
NODE_MAJOR="${NODE_MAJOR:-24}"
ASSUME_YES="${ASSUME_YES:-0}"

# ---------------------------------------------------------------------------
# Ausgabe
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'
else
  B=""; G=""; Y=""; R=""; D=""; N=""
fi

STEP=0
step()  { STEP=$((STEP + 1)); printf '\n%s[%02d] %s%s\n' "$B" "$STEP" "$1" "$N"; }
ok()    { printf '     %s✓%s %s\n' "$G" "$N" "$1"; }
skip()  { printf '     %s·%s %s %s(bereits erledigt)%s\n' "$D" "$N" "$1" "$D" "$N"; }
warn()  { printf '     %s!%s %s\n' "$Y" "$N" "$1"; }
die()   { printf '\n%sAbbruch:%s %s\n' "$R" "$N" "$1" >&2; exit 1; }

ask() {
  # ask VARIABLE "Frage" ["Vorgabe"]
  local var="$1" prompt="$2" default="${3:-}" current answer
  current="$(eval "printf '%s' \"\${$var:-}\"")"

  if [ -n "$current" ]; then return 0; fi
  if [ "$ASSUME_YES" = "1" ] && [ -n "$default" ]; then
    eval "$var=\"\$default\""
    return 0
  fi

  if [ -n "$default" ]; then
    read -r -p "     $prompt [$default]: " answer </dev/tty
    answer="${answer:-$default}"
  else
    read -r -p "     $prompt: " answer </dev/tty
  fi
  [ -n "$answer" ] || die "\"$prompt\" darf nicht leer bleiben."
  eval "$var=\"\$answer\""
}

# ---------------------------------------------------------------------------
# 01 Voraussetzungen
# ---------------------------------------------------------------------------
preflight() {
  step "Voraussetzungen prüfen"

  [ "$(id -u)" -eq 0 ] || die "Bitte mit sudo ausführen."

  . /etc/os-release 2>/dev/null || die "/etc/os-release fehlt — kein unterstütztes System."
  case "${ID:-}" in
    ubuntu|debian) ok "System: ${PRETTY_NAME}" ;;
    *) die "Nur Ubuntu und Debian werden unterstützt, gefunden: ${PRETTY_NAME:-unbekannt}" ;;
  esac

  [ "$(uname -m)" = "x86_64" ] || warn "Architektur $(uname -m) — die Container-Images sind auf x86_64 am besten getestet."

  local cg
  cg="$(stat -fc %T /sys/fs/cgroup 2>/dev/null || echo unbekannt)"
  [ "$cg" = "cgroup2fs" ] || die "cgroup v2 wird gebraucht (gefunden: $cg). Ohne sie greifen die Speichergrenzen der Container nicht."
  ok "cgroup v2 aktiv"

  ping -c1 -W3 deb.debian.org >/dev/null 2>&1 ||
    curl -fsS --max-time 5 https://deb.debian.org >/dev/null 2>&1 ||
    warn "Keine Netzverbindung erkennbar — die Installation braucht eine."

  MEM_MB=$(($(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1024))
  CPU_THREADS=$(nproc)
  ok "Hardware: ${MEM_MB} MB RAM, ${CPU_THREADS} CPU-Threads"
}

# ---------------------------------------------------------------------------
# 02 Angaben einsammeln
# ---------------------------------------------------------------------------
gather_config() {
  step "Angaben einsammeln"

  ask DOMAIN     "Deine Domain (z. B. neuhauser.app)"
  ask PANEL_HOST "Hostname des Panels" "panel.$DOMAIN"
  ask MC_HOST    "Basis der Server-Adressen (Wildcard zeigt hierauf)" "mc.$DOMAIN"
  ask ACME_EMAIL "E-Mail für die Zertifikate"

  ok "Panel:  https://$PANEL_HOST"
  ok "Server: <name>.$MC_HOST"

  cat <<EOF

     ${D}Dafür müssen zwei DNS-Einträge auf die öffentliche IP dieses Hosts zeigen:
       $PANEL_HOST        A
       *.$MC_HOST         A${N}
EOF
}

# ---------------------------------------------------------------------------
# 03 Pakete
# ---------------------------------------------------------------------------
install_packages() {
  step "Systempakete installieren"

  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq \
    ca-certificates curl gnupg git jq \
    zfsutils-linux \
    ufw fail2ban unattended-upgrades \
    cifs-utils zstd >/dev/null

  ok "Basispakete installiert"

  if ! command -v node >/dev/null 2>&1 || \
     [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 23 ]; then
    # Agent und Tests laufen als TypeScript direkt über Node; Typen werden
    # erst ab 23.6 ohne zusätzliches Flag gestrippt.
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
    ok "Node $(node -v) installiert"
  else
    skip "Node $(node -v)"
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || npm install -g pnpm >/dev/null
    corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true
    ok "pnpm $(pnpm -v 2>/dev/null || echo '') bereit"
  else
    skip "pnpm $(pnpm -v)"
  fi
}

# ---------------------------------------------------------------------------
# 04 ZFS-Pool  — der einzige unwiderrufliche Schritt
# ---------------------------------------------------------------------------
setup_zfs() {
  step "ZFS-Pool einrichten"

  if [ "${SKIP_ZFS:-0}" = "1" ]; then
    warn "Übersprungen (SKIP_ZFS=1). Ohne ZFS gibt es keine harten Speichergrenzen."
    return 0
  fi

  if zpool list "$ZFS_POOL" >/dev/null 2>&1; then
    skip "Pool \"$ZFS_POOL\" existiert"
  else
    local root_disk candidates
    root_disk="$(lsblk -no PKNAME "$(findmnt -no SOURCE /)" 2>/dev/null | head -1 || true)"

    printf '\n     %sVerfügbare Platten:%s\n\n' "$B" "$N"
    printf '     %-12s %-10s %-28s %s\n' "GERÄT" "GRÖSSE" "MODELL" "HINWEIS"
    candidates=()
    while read -r name size model; do
      local note=""
      [ "$name" = "$root_disk" ] && note="${R}Systemplatte — Finger weg${N}"
      if [ -z "$note" ] && lsblk -no MOUNTPOINT "/dev/$name" 2>/dev/null | grep -q .; then
        note="${Y}enthält eingehängte Dateisysteme${N}"
      fi
      [ -z "$note" ] && { note="frei"; candidates+=("$name"); }
      printf '     %-12s %-10s %-28s %b\n' "$name" "$size" "${model:--}" "$note"
    done < <(lsblk -dno NAME,SIZE,MODEL --sort SIZE | tac)

    [ ${#candidates[@]} -gt 0 ] || die "Keine freie Platte gefunden. Mit SKIP_ZFS=1 ohne ZFS fortfahren."

    printf '\n     %sStabile Bezeichner der freien Platten:%s\n' "$B" "$N"
    for name in "${candidates[@]}"; do
      for link in /dev/disk/by-id/*; do
        [ "$(readlink -f "$link")" = "/dev/$name" ] || continue
        case "$link" in *-part*) continue ;; esac
        printf '     %s\n' "$link"
      done
    done

    printf '\n'
    ask ZFS_DISK "Welche Platte wird der Pool? (vollständiger by-id-Pfad)"

    [ -e "$ZFS_DISK" ] || die "\"$ZFS_DISK\" existiert nicht."
    local target
    target="$(readlink -f "$ZFS_DISK")"
    [ "$(basename "$target")" != "$root_disk" ] || die "Das ist die Systemplatte."

    printf '\n     %s%s ALLE DATEN AUF %s WERDEN GELÖSCHT %s\n' "$R" "$B" "$target" "$N"
    lsblk "$target" | sed 's/^/     /'

    if [ "$ASSUME_YES" != "1" ]; then
      local confirm
      read -r -p "     Zum Bestätigen LOESCHEN eingeben: " confirm </dev/tty
      [ "$confirm" = "LOESCHEN" ] || die "Nicht bestätigt."
    fi

    zpool create -f -o ashift=12 \
      -O compression=lz4 -O atime=off -O xattr=sa -O acltype=posixacl \
      -O canmount=off -m none \
      "$ZFS_POOL" "$ZFS_DISK"
    ok "Pool \"$ZFS_POOL\" angelegt"
  fi

  zfs list "$ZFS_POOL/mc" >/dev/null 2>&1 || \
    zfs create -o mountpoint="$DATA_ROOT" "$ZFS_POOL/mc"
  zfs list "$ZFS_POOL/backups" >/dev/null 2>&1 || \
    zfs create -o mountpoint="$BACKUP_ROOT" "$ZFS_POOL/backups"
  ok "Datasets unter $DATA_ROOT und $BACKUP_ROOT"

  POOL_MB=$(($(zpool list -Hp -o size "$ZFS_POOL") / 1024 / 1024))
  ok "Pool-Größe: ${POOL_MB} MB"
}

# ---------------------------------------------------------------------------
# 05 ARC begrenzen
# ---------------------------------------------------------------------------
tune_arc() {
  step "ZFS-Cache begrenzen"

  # Rund 12 % des Arbeitsspeichers, mindestens 2 GB, höchstens 16 GB.
  ARC_MB=$((MEM_MB * 12 / 100))
  [ "$ARC_MB" -lt 2048 ] && ARC_MB=2048
  [ "$ARC_MB" -gt 16384 ] && ARC_MB=16384
  local arc_bytes=$((ARC_MB * 1024 * 1024))

  # Ohne Deckel wächst der Cache, bis der Kernel Druck meldet — und der
  # trifft dann JVMs, die ihren Speicher nicht hergeben können.
  echo "options zfs zfs_arc_max=$arc_bytes" > /etc/modprobe.d/zfs.conf
  update-initramfs -u >/dev/null 2>&1 || true
  [ -w /sys/module/zfs/parameters/zfs_arc_max ] && \
    echo "$arc_bytes" > /sys/module/zfs/parameters/zfs_arc_max || true

  ok "ARC auf ${ARC_MB} MB begrenzt"
}

# ---------------------------------------------------------------------------
# 06 Docker
# ---------------------------------------------------------------------------
install_docker() {
  step "Docker installieren"

  if command -v docker >/dev/null 2>&1; then
    skip "Docker $(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  else
    curl -fsSL https://get.docker.com | sh >/dev/null
    ok "Docker installiert"
  fi

  # Log-Rotation global: Ein gesprächiges Plugin füllt sonst die Systemplatte.
  # live-restore hält Container über einen Daemon-Neustart am Leben.
  if [ ! -f /etc/docker/daemon.json ]; then
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "3" },
  "live-restore": true,
  "default-ulimits": {
    "nofile": { "Name": "nofile", "Soft": 65536, "Hard": 65536 }
  }
}
EOF
    systemctl restart docker
    ok "Docker-Konfiguration geschrieben"
  else
    skip "Docker-Konfiguration vorhanden"
  fi

  docker network inspect mc-net >/dev/null 2>&1 || docker network create mc-net >/dev/null
  ok "Netz mc-net bereit"
}

# ---------------------------------------------------------------------------
# 07 Kernel-Parameter
# ---------------------------------------------------------------------------
tune_kernel() {
  step "Kernel-Parameter setzen"

  cat > /etc/sysctl.d/99-mc-saas.conf <<'EOF'
# JVMs dürfen niemals swappen — lieber sauber sterben als das System lahmlegen.
vm.swappiness = 1
# Die JVM legt sehr viele Speicher-Mappings an.
vm.max_map_count = 262144
# Viele gleichzeitige Verbindungen über den Router.
net.core.somaxconn = 1024
net.ipv4.tcp_max_syn_backlog = 2048
fs.file-max = 1000000
fs.inotify.max_user_watches = 524288
EOF
  sysctl --system >/dev/null
  ok "sysctl-Werte gesetzt"
}

# ---------------------------------------------------------------------------
# 08 Firewall
# ---------------------------------------------------------------------------
setup_firewall() {
  step "Firewall einrichten"

  ufw --force default deny incoming >/dev/null
  ufw --force default allow outgoing >/dev/null
  ufw allow 22/tcp    >/dev/null   # SSH
  ufw allow 80/tcp    >/dev/null   # ACME und Weiterleitung
  ufw allow 443/tcp   >/dev/null   # Panel
  ufw allow 25565/tcp >/dev/null   # Minecraft über mc-router
  ufw --force enable  >/dev/null

  ok "Offen: 22, 80, 443, 25565"
  warn "Docker schreibt eigene iptables-Regeln an ufw vorbei. Nach jedem Compose-Umbau prüfen: docker ps --format '{{.Names}} {{.Ports}}' — außer mc-router darf nirgends 0.0.0.0 stehen."
}

# ---------------------------------------------------------------------------
# 09 SSH und automatische Updates
# ---------------------------------------------------------------------------
harden_ssh() {
  step "SSH absichern"

  if grep -qE '^\s*PasswordAuthentication\s+no' /etc/ssh/sshd_config; then
    skip "Passwort-Anmeldung bereits aus"
  elif [ -s "${SUDO_USER:+/home/$SUDO_USER/.ssh/authorized_keys}" ] 2>/dev/null || [ -s /root/.ssh/authorized_keys ]; then
    sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
    sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
    ok "Nur noch Schlüssel-Anmeldung"
  else
    # Sonst sperrt sich der Nutzer selbst aus.
    warn "Kein hinterlegter SSH-Schlüssel gefunden — Passwort-Anmeldung bleibt an. Erst Schlüssel einrichten, dann abschalten."
  fi

  systemctl enable --now fail2ban >/dev/null 2>&1 || true
  ok "fail2ban aktiv"
}

# ---------------------------------------------------------------------------
# 10 Dienstkonten
# ---------------------------------------------------------------------------
create_users() {
  step "Dienstkonten anlegen"

  getent group mcsaas >/dev/null || groupadd --system mcsaas
  id mcagent >/dev/null 2>&1 || useradd --system --gid mcsaas --home /opt/mc-saas --shell /usr/sbin/nologin mcagent
  id mcpanel >/dev/null 2>&1 || useradd --system --gid mcsaas --home /opt/mc-saas --shell /usr/sbin/nologin mcpanel

  # Nur der Agent darf Docker — das Panel braucht es nicht und soll es nicht.
  usermod -aG docker mcagent
  ok "mcagent (Docker + ZFS) und mcpanel angelegt"

  if [ "${SKIP_ZFS:-0}" != "1" ] && zpool list "$ZFS_POOL" >/dev/null 2>&1; then
    # Gezielte Rechte statt pauschalem sudo: nur unterhalb dieser Datasets.
    zfs allow -u mcagent create,destroy,mount,quota,snapshot,rollback,hold,receive "$ZFS_POOL/mc"
    zfs allow -u mcagent create,destroy,mount,snapshot,receive "$ZFS_POOL/backups"
    ok "ZFS-Rechte an mcagent delegiert"
  fi

  install -d -o mcagent -g mcsaas -m 0775 "$DATA_ROOT" "$BACKUP_ROOT"
}

# ---------------------------------------------------------------------------
# 11 Anwendung holen
# ---------------------------------------------------------------------------
deploy_app() {
  step "Anwendung holen"

  install -d -o root -g mcsaas -m 0755 /opt/mc-saas

  if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
    git -C "$APP_DIR" reset --hard --quiet "origin/$BRANCH"
    ok "Auf $(git -C "$APP_DIR" rev-parse --short HEAD) aktualisiert"
  else
    git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
    ok "Nach $APP_DIR geklont"
  fi

  cd "$APP_DIR"
  pnpm install --frozen-lockfile --silent
  ok "Abhängigkeiten installiert"
}

# ---------------------------------------------------------------------------
# 12 Konfiguration schreiben
# ---------------------------------------------------------------------------
write_env() {
  step "Konfiguration schreiben"

  if [ -f "$ENV_FILE" ]; then
    skip ".env vorhanden — Geheimnisse bleiben unverändert"
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
    return 0
  fi

  local pg_pass auth_secret agent_token
  pg_pass="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
  auth_secret="$(openssl rand -base64 32)"
  agent_token="$(openssl rand -base64 36 | tr -d '/+=' | head -c 48)"

  # Reserviert: ARC + 2 GB System + 4 GB Dienste (Postgres, Redis, Panel, Agent).
  local reserved_mb=$((ARC_MB + 2048 + 4096))
  local pool_mb="${POOL_MB:-0}"
  # 20 % Reserve: ZFS wird oberhalb von etwa 85 % Füllstand deutlich langsamer.
  local reserved_disk_mb=$((pool_mb * 20 / 100))

  cat > "$ENV_FILE" <<EOF
# Erzeugt von deploy/setup.sh am $(date -Iseconds)
# Enthält Geheimnisse — nicht ins Repo, nicht weitergeben.

DATABASE_URL="postgresql://mcsaas:${pg_pass}@127.0.0.1:5432/mcsaas?schema=public"
REDIS_URL="redis://127.0.0.1:6379"
POSTGRES_PASSWORD="${pg_pass}"

BETTER_AUTH_SECRET="${auth_secret}"
BETTER_AUTH_URL="https://${PANEL_HOST}"

AGENT_URL="http://127.0.0.1:8787"
AGENT_TOKEN="${agent_token}"
AGENT_DATA_ROOT="${DATA_ROOT}"
AGENT_BACKUP_ROOT="${BACKUP_ROOT}"
AGENT_ZFS_POOL="${ZFS_POOL}/mc"
AGENT_ROUTER_URL="http://127.0.0.1:8080"
AGENT_ROUTER_HOST="127.0.0.1"
AGENT_ROUTER_PORT="25565"
AGENT_MAX_UPLOAD_MB="256"
# RCON bleibt im internen Netz — auf dem Linux-Host erreicht der Agent
# die Container direkt über die Bridge.
AGENT_PUBLISH_RCON="false"

MAIL_TRANSPORT="console"
MAIL_FROM="noreply@${DOMAIN}"

PANEL_HOST="${PANEL_HOST}"
ACME_EMAIL="${ACME_EMAIL}"

# Eckdaten dieses Hosts, ermittelt beim Einrichten.
NODE_TOTAL_MEMORY_MB=${MEM_MB}
NODE_TOTAL_CPU_CORES=${CPU_THREADS}
NODE_TOTAL_DISK_MB=${pool_mb}
NODE_RESERVED_MEMORY_MB=${reserved_mb}
NODE_RESERVED_DISK_MB=${reserved_disk_mb}
NODE_PUBLIC_HOST="${MC_HOST}"
EOF

  chown root:mcsaas "$ENV_FILE"
  chmod 0640 "$ENV_FILE"

  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a

  ok "Geheimnisse erzeugt, .env geschrieben (root:mcsaas, 0640)"
  ok "Für Server nutzbar: $((MEM_MB - reserved_mb)) MB RAM"
}

# ---------------------------------------------------------------------------
# 13 Bauen
# ---------------------------------------------------------------------------
build_app() {
  step "Anwendung bauen"

  cd "$APP_DIR"
  pnpm db:generate >/dev/null
  ok "Prisma-Client erzeugt"

  pnpm build >/dev/null
  ok "Panel gebaut"

  # Der Panel-Dienst schreibt in .next (Cache), der Rest bleibt lesbar.
  chown -R root:mcsaas "$APP_DIR"
  chmod -R g+rX "$APP_DIR"
  chown -R mcpanel:mcsaas "$APP_DIR/.next"
}

# ---------------------------------------------------------------------------
# 14 Infrastruktur starten
# ---------------------------------------------------------------------------
start_infra() {
  step "Postgres, Redis, Router und Caddy starten"

  cd "$APP_DIR/deploy"
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" PANEL_HOST="$PANEL_HOST" ACME_EMAIL="$ACME_EMAIL" \
    docker compose -f docker-compose.prod.yml up -d >/dev/null 2>&1

  local _
  for _ in $(seq 1 60); do
    docker exec "$(docker compose -f docker-compose.prod.yml ps -q postgres)" \
      pg_isready -U mcsaas -d mcsaas >/dev/null 2>&1 && break
    sleep 2
  done
  ok "Datenbank erreichbar"
  ok "mc-router lauscht auf 25565, Caddy auf 80 und 443"
}

# ---------------------------------------------------------------------------
# 15 Datenbank einrichten
# ---------------------------------------------------------------------------
init_database() {
  step "Datenbank einrichten"

  cd "$APP_DIR"
  pnpm db:push >/dev/null
  ok "Schema geschrieben"

  pnpm db:seed 2>&1 | sed 's/^/     /'
}

# ---------------------------------------------------------------------------
# 16 Dienste einrichten
# ---------------------------------------------------------------------------
install_units() {
  step "systemd-Dienste einrichten"

  install -m 0644 "$APP_DIR/deploy/mc-agent.service" /etc/systemd/system/
  install -m 0644 "$APP_DIR/deploy/mc-panel.service" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now mc-agent.service >/dev/null
  systemctl enable --now mc-panel.service >/dev/null

  sleep 4
  systemctl is-active --quiet mc-agent || die "mc-agent startet nicht — journalctl -u mc-agent -n 50"
  systemctl is-active --quiet mc-panel || die "mc-panel startet nicht — journalctl -u mc-panel -n 50"
  ok "mc-agent und mc-panel laufen"
}

# ---------------------------------------------------------------------------
# 17 Abnahme
# ---------------------------------------------------------------------------
verify() {
  step "Abnahme"

  local fails=0
  check() {
    if eval "$2" >/dev/null 2>&1; then ok "$1"; else warn "$1 — FEHLGESCHLAGEN"; fails=$((fails + 1)); fi
  }

  check "ZFS-Pool online"      "[ '${SKIP_ZFS:-0}' = '1' ] || zpool status -x $ZFS_POOL | grep -q 'is healthy'"
  check "Docker antwortet"     "docker info"
  check "Netz mc-net"          "docker network inspect mc-net"
  check "Datenbank"            "docker exec \$(docker compose -f $APP_DIR/deploy/docker-compose.prod.yml ps -q postgres) pg_isready -U mcsaas"
  check "Agent /health"        "curl -fsS -H 'Authorization: Bearer $AGENT_TOKEN' http://127.0.0.1:8787/health"
  check "Panel antwortet"      "curl -fsS -o /dev/null http://127.0.0.1:3000/login"
  check "Router-API"           "curl -fsS -o /dev/null http://127.0.0.1:8080/routes"
  check "Port 25565 offen"     "ss -lnt | grep -q ':25565'"

  # Sicherheitsprüfung: Außer mc-router darf nichts an 0.0.0.0 hängen.
  local exposed
  exposed="$(docker ps --format '{{.Names}} {{.Ports}}' | grep '0.0.0.0' | grep -v 'mc-router' || true)"
  if [ -n "$exposed" ]; then
    warn "Container mit offenen Ports gefunden:"
    printf '     %s\n' "$exposed"
    fails=$((fails + 1))
  else
    ok "Kein Container außer mc-router nach außen offen"
  fi

  [ "$fails" -eq 0 ] || die "$fails Prüfungen fehlgeschlagen."
}

summary() {
  local server_mb=$((MEM_MB - ${NODE_RESERVED_MEMORY_MB:-0}))

  cat <<EOF

${B}${G}Fertig.${N}

  Panel        ${B}https://$PANEL_HOST${N}
  Server       <name>.$MC_HOST

  Für Server   ${server_mb} MB RAM, ${CPU_THREADS} Threads
  ZFS-Cache    ${ARC_MB} MB

${B}Was jetzt noch fehlt:${N}

  1. DNS-Einträge auf die öffentliche IP dieses Hosts:
       $PANEL_HOST     A
       *.$MC_HOST      A

  2. Im Router weiterleiten: 25565/TCP, 443/TCP, 80/TCP
     ${D}Nicht 22, 5432, 6379, 8080 oder 8787.${N}

  3. Auf $PANEL_HOST registrieren. Der Bestätigungslink wird noch nicht
     verschickt, sondern steht im Log:
       journalctl -u mc-panel -f

  4. Danach zum Admin machen:
       cd $APP_DIR && sudo -u mcpanel pnpm tsx scripts/promote-admin.ts DEINE@MAIL

${B}Betrieb:${N}
  systemctl status mc-agent mc-panel
  journalctl -u mc-agent -f
  cd $APP_DIR/deploy && docker compose -f docker-compose.prod.yml ps

EOF
}

# ---------------------------------------------------------------------------
main() {
  printf '%s\nMinecraft-SaaS — vollständige Einrichtung%s\n' "$B" "$N"

  preflight
  gather_config
  install_packages
  setup_zfs
  tune_arc
  install_docker
  tune_kernel
  setup_firewall
  harden_ssh
  create_users
  deploy_app
  write_env
  build_app
  start_infra
  init_database
  install_units
  verify
  summary
}

main "$@"
