#!/usr/bin/env bash
#
# PolySIEM installer — Docker-based one-liner install.
#
# Usage:
#   curl -fsSL https://github.com/Realynx/PolySIEM/releases/latest/download/install.sh | bash
#
# Build from source instead of pulling the release image:
#   curl -fsSL https://raw.githubusercontent.com/Realynx/PolySIEM/master/deploy/install.sh | bash -s -- --source
#
# Environment overrides:
#   INSTALL_DIR     install location            (default: /opt/polysiem)
#   POLYSIEM_REPO    GitHub repository URL       (default: https://github.com/Realynx/PolySIEM)
#   POLYSIEM_BRANCH  branch for raw downloads    (default: master)
#
# Idempotent: re-running keeps your .env, pulls a newer image and restarts.
#
set -euo pipefail

POLYSIEM_REPO="${POLYSIEM_REPO:-https://github.com/Realynx/PolySIEM}"
POLYSIEM_BRANCH="${POLYSIEM_BRANCH:-master}"
INSTALL_DIR="${INSTALL_DIR:-/opt/polysiem}"

REPO_SLUG="${POLYSIEM_REPO#https://github.com/}"
REPO_SLUG="${REPO_SLUG%.git}"
IMAGE_SLUG="$(printf '%s' "$REPO_SLUG" | tr '[:upper:]' '[:lower:]')"
RELEASE_BASE="https://github.com/${REPO_SLUG}/releases/latest/download"
RELEASE_IMAGE="ghcr.io/${IMAGE_SLUG}:latest"

SOURCE_MODE=0

log()  { printf '\033[1;36m[polysiem]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[polysiem]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[polysiem] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

banner() {
    cat <<'EOF'

  ____       _       ____ ___ _____ __  __
 |  _ \ ___ | |_   _/ ___|_ _| ____|  \/  |
 | |_) / _ \| | | | \___ \| ||  _| | |\/| |
 |  __/ (_) | | |_| |___) | || |___| |  | |
 |_|   \___/|_|\__, |____/___|_____|_|  |_|
               |___/

 Self-hosted homelab documentation dashboard
EOF
}

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --source) SOURCE_MODE=1 ;;
            -h|--help)
                grep '^#' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true
                exit 0
                ;;
            *) die "unknown option: $1 (supported: --source)" ;;
        esac
        shift
    done
}

require_root() {
    if [ "$(id -u)" -eq 0 ]; then
        return 0
    fi
    command -v sudo >/dev/null 2>&1 || die "please run this installer as root (sudo not found)"
    log "Not running as root — re-executing with sudo..."
    if [ -r "$0" ] && grep -q "PolySIEM installer" "$0" 2>/dev/null; then
        exec sudo -E bash "$0" "$@"
    fi
    # Piped via curl | bash: fetch a fresh copy and re-exec that under sudo.
    tmp_self="$(mktemp /tmp/polysiem-install.XXXXXX)"
    curl -fsSL "${RELEASE_BASE}/install.sh" -o "$tmp_self" \
        || die "could not re-download installer for sudo re-exec"
    exec sudo -E bash "$tmp_self" "$@"
}

detect_os() {
    [ -r /etc/os-release ] || die "cannot detect OS (/etc/os-release missing). Install Docker manually, then re-run."
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-} ${ID_LIKE:-}" in
        *debian*|*ubuntu*)          OS_FAMILY="apt" ;;
        *fedora*|*rhel*|*centos*)   OS_FAMILY="dnf" ;;
        *) die "unsupported OS '${ID:-unknown}'. PolySIEM's installer supports Debian/Ubuntu and Fedora/RHEL families. Install Docker + compose manually, then use deploy/docker-compose.yml." ;;
    esac
    log "Detected OS: ${PRETTY_NAME:-${ID:-unknown}} (${OS_FAMILY} family)"
}

ensure_docker() {
    if command -v docker >/dev/null 2>&1; then
        log "Docker already installed: $(docker --version)"
    else
        log "Installing Docker via get.docker.com..."
        curl -fsSL https://get.docker.com | sh
        systemctl enable --now docker >/dev/null 2>&1 || true
    fi
    docker info >/dev/null 2>&1 || die "Docker daemon is not running (try: systemctl start docker)"
    if ! docker compose version >/dev/null 2>&1; then
        log "Docker Compose plugin missing — installing..."
        if [ "$OS_FAMILY" = "apt" ]; then
            apt-get update -qq && apt-get install -y -qq docker-compose-plugin
        else
            dnf install -y -q docker-compose-plugin
        fi
        docker compose version >/dev/null 2>&1 || die "could not install the Docker Compose plugin"
    fi
    log "Docker Compose: $(docker compose version --short 2>/dev/null || echo ok)"
}

load_release_metadata() {
    [ "$SOURCE_MODE" -eq 1 ] && return 0
    manifest="$(mktemp /tmp/polysiem-release.XXXXXX)"
    curl -fsSL "${RELEASE_BASE}/release-manifest.json" -o "$manifest" \
        || die "could not download release-manifest.json"
    image="$(sed -n 's/.*"image"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1)"
    rm -f "$manifest"
    case "$image" in
        ghcr.io/*:*) RELEASE_IMAGE="$image" ;;
        *) die "the GitHub release manifest contains an invalid container image" ;;
    esac
}

primary_ip() {
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [ -z "$ip" ]; then
        ip="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="src") print $(i+1); exit}')"
    fi
    echo "${ip:-localhost}"
}

write_env() {
    if [ -f "${INSTALL_DIR}/.env" ]; then
        log "Keeping existing ${INSTALL_DIR}/.env (secrets preserved)"
        return 0
    fi
    log "Generating ${INSTALL_DIR}/.env with fresh secrets..."
    command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets"
    app_secret="$(openssl rand -hex 32)"
    db_password="$(openssl rand -hex 24)"
    host_ip="$(primary_ip)"
    cat > "${INSTALL_DIR}/.env" <<EOF
# PolySIEM configuration — generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by install.sh
# BACK THIS FILE UP. APP_SECRET encrypts your integration credentials:
# if you lose it, you must re-enter them.
DATABASE_URL=postgresql://polysiem:${db_password}@db:5432/polysiem
APP_SECRET=${app_secret}
APP_URL=https://${host_ip}:3000
DB_PASSWORD=${db_password}
POLYSIEM_IMAGE=${RELEASE_IMAGE}
POLYSIEM_GITHUB_REPOSITORY=${REPO_SLUG}
POLYSIEM_INSTALL_TYPE=$([ "$SOURCE_MODE" -eq 1 ] && printf 'docker-source' || printf 'docker')
POLYSIEM_AUTO_UPDATE_CAPABLE=$([ "$SOURCE_MODE" -eq 1 ] && printf 'false' || printf 'true')
POLYSIEM_UPDATE_AGENT_TOKEN=$(openssl rand -hex 32)
EOF
    chmod 600 "${INSTALL_DIR}/.env"
}

ensure_install_metadata() {
    # Older installs predate these non-secret release settings. Add them once
    # without touching any existing configuration or secrets.
    if ! grep -q '^POLYSIEM_IMAGE=' "${INSTALL_DIR}/.env"; then
        printf '\nPOLYSIEM_IMAGE=%s\n' "$RELEASE_IMAGE" >> "${INSTALL_DIR}/.env"
    fi
    if ! grep -q '^POLYSIEM_GITHUB_REPOSITORY=' "${INSTALL_DIR}/.env"; then
        printf 'POLYSIEM_GITHUB_REPOSITORY=%s\n' "$REPO_SLUG" >> "${INSTALL_DIR}/.env"
    fi
    if ! grep -q '^POLYSIEM_INSTALL_TYPE=' "${INSTALL_DIR}/.env"; then
        if [ "$SOURCE_MODE" -eq 1 ]; then install_type="docker-source"; else install_type="docker"; fi
        printf 'POLYSIEM_INSTALL_TYPE=%s\n' "$install_type" >> "${INSTALL_DIR}/.env"
    fi
    if ! grep -q '^POLYSIEM_AUTO_UPDATE_CAPABLE=' "${INSTALL_DIR}/.env"; then
        if [ "$SOURCE_MODE" -eq 1 ]; then capable=false; else capable=true; fi
        printf 'POLYSIEM_AUTO_UPDATE_CAPABLE=%s\n' "$capable" >> "${INSTALL_DIR}/.env"
    fi
    if [ "$SOURCE_MODE" -eq 0 ] \
        && ! grep -q '^POLYSIEM_UPDATE_AGENT_TOKEN=' "${INSTALL_DIR}/.env"; then
        printf 'POLYSIEM_UPDATE_AGENT_TOKEN=%s\n' "$(openssl rand -hex 32)" >> "${INSTALL_DIR}/.env"
    fi
}

install_updater() {
    log "Installing transactional updater..."
    curl -fsSL "${RELEASE_BASE}/update.sh" -o "${INSTALL_DIR}/update.sh" \
        || die "could not download update.sh (check POLYSIEM_REPO / network)"
    chmod 700 "${INSTALL_DIR}/update.sh"
}

install_auto_update_timer() {
    [ "$SOURCE_MODE" -eq 0 ] || return 0
    command -v systemctl >/dev/null 2>&1 || {
        warn "systemd is unavailable; automatic updates can be checked manually but cannot be scheduled"
        return 0
    }
    log "Installing opt-in automatic update timer..."
    curl -fsSL "${RELEASE_BASE}/auto-update.sh" -o "${INSTALL_DIR}/auto-update.sh" \
        || die "could not download auto-update.sh"
    chmod 700 "${INSTALL_DIR}/auto-update.sh"
    cat > /etc/systemd/system/polysiem-auto-update.service <<EOF
[Unit]
Description=PolySIEM automatic update check
After=docker.service network-online.target

[Service]
Type=oneshot
Environment=INSTALL_DIR=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/auto-update.sh
EOF
    cat > /etc/systemd/system/polysiem-auto-update.timer <<'EOF'
[Unit]
Description=Check for verified PolySIEM releases

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min
RandomizedDelaySec=2min
Persistent=true

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now polysiem-auto-update.timer >/dev/null
}

deploy_release() {
    log "Downloading docker-compose.yml from the latest GitHub release..."
    curl -fsSL "${RELEASE_BASE}/docker-compose.yml" -o "${INSTALL_DIR}/docker-compose.yml" \
        || die "could not download docker-compose.yml (check POLYSIEM_REPO / network)"
    cd "$INSTALL_DIR"
    log "Pulling PolySIEM image..."
    docker compose pull
    log "Starting containers..."
    docker compose up -d
}

deploy_source() {
    command -v git >/dev/null 2>&1 || {
        log "Installing git..."
        if [ "$OS_FAMILY" = "apt" ]; then
            apt-get update -qq && apt-get install -y -qq git
        else
            dnf install -y -q git
        fi
    }
    if [ -d "${INSTALL_DIR}/src/.git" ]; then
        log "Updating existing source checkout..."
        git -C "${INSTALL_DIR}/src" pull --ff-only origin "$POLYSIEM_BRANCH"
    else
        log "Cloning ${POLYSIEM_REPO}..."
        git clone --depth 1 --branch "$POLYSIEM_BRANCH" "$POLYSIEM_REPO" "${INSTALL_DIR}/src"
    fi
    # The source compose file expects .env at the repo root; link it to ours.
    ln -sfn "${INSTALL_DIR}/.env" "${INSTALL_DIR}/src/.env"
    cd "${INSTALL_DIR}/src"
    log "Building PolySIEM image from source (this can take a few minutes)..."
    docker compose --env-file "${INSTALL_DIR}/.env" -f deploy/docker-compose.source.yml up -d --build
}

wait_for_health() {
    log "Waiting for PolySIEM to become healthy (up to 90s)..."
    i=0
    while [ "$i" -lt 45 ]; do
        # -kL: follow the HTTP->HTTPS redirect and accept the self-signed cert.
        if curl -fsSkL http://localhost:3000/api/health >/dev/null 2>&1; then
            return 0
        fi
        i=$((i + 1))
        sleep 2
    done
    return 1
}

success_box() {
    host_ip="$(primary_ip)"
    if [ "$SOURCE_MODE" -eq 1 ]; then
        update_text="re-run this installer with --source after taking a database backup"
    else
        update_text="sudo ${INSTALL_DIR}/update.sh (backup + automatic rollback)"
    fi
    cat <<EOF

 ==============================================================
  PolySIEM is up and running!

  Open:        https://${host_ip}:3000
               (self-signed certificate — your browser warns once;
               replace it under Settings -> Web certificate)
  Next step:   the setup wizard in your browser creates the
               first admin account — no CLI steps needed.

  Data:
    Config     ${INSTALL_DIR}/.env   (back this up! APP_SECRET
               encrypts integration credentials)
    Database   docker volume 'polysiem-pgdata'

  Update:      ${update_text}

  Logs:        cd ${INSTALL_DIR} && docker compose logs -f polysiem
 ==============================================================

EOF
}

main() {
    banner
    parse_args "$@"
    require_root "$@"
    detect_os
    ensure_docker
    load_release_metadata
    mkdir -p "$INSTALL_DIR"
    write_env
    ensure_install_metadata
    install_updater
    install_auto_update_timer
    if [ "$SOURCE_MODE" -eq 1 ]; then
        deploy_source
    else
        deploy_release
    fi
    if wait_for_health; then
        success_box
    else
        warn "PolySIEM did not report healthy within 90s."
        warn "Check logs with: cd ${INSTALL_DIR} && docker compose logs -f"
        exit 1
    fi
}

main "$@"
