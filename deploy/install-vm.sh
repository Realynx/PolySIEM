#!/usr/bin/env bash
#
# PolySIEM native VM installer (Debian/Ubuntu — e.g. a Proxmox VM or LXC).
#
# Installs Node 22 (NodeSource), PostgreSQL (distro), builds PolySIEM from
# source and runs it as a hardened systemd service (polysiem.service).
#
# Usage:
#   curl -fsSL https://github.com/Realynx/PolySIEM/releases/latest/download/install-vm.sh | bash
#
# Environment overrides:
#   POLYSIEM_REPO    GitHub repository URL   (default: https://github.com/Realynx/PolySIEM)
#   POLYSIEM_REF     git tag/branch to build (default: latest release tag)
#
# Layout:
#   /opt/polysiem/app   source checkout (build tree)
#   /opt/polysiem/run   runtime dir (standalone server, what systemd runs)
#   /opt/polysiem/.env  configuration + secrets (BACK IT UP)
#
# Idempotent: re-running = upgrade (git pull, rebuild, migrate, restart).
#
set -Eeuo pipefail

POLYSIEM_REPO="${POLYSIEM_REPO:-https://github.com/Realynx/PolySIEM}"
REPO_SLUG="${POLYSIEM_REPO#https://github.com/}"
REPO_SLUG="${REPO_SLUG%.git}"
RELEASE_BASE="https://github.com/${REPO_SLUG}/releases/latest/download"
POLYSIEM_REF="${POLYSIEM_REF:-${POLYSIEM_BRANCH:-}}"
BASE_DIR="/opt/polysiem"
APP_DIR="${BASE_DIR}/app"
RUN_DIR="${BASE_DIR}/run"
ENV_FILE="${BASE_DIR}/.env"
BACKUP_ROOT="${BASE_DIR}/backups"
BACKUP_DIR=""
ROLLBACK_ARMED=0
ROLLING_BACK=0
SERVICE_STOPPED_FOR_UPDATE=0

log()  { printf '\033[1;36m[polysiem]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[polysiem]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[polysiem] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

require_root() {
    if [ "$(id -u)" -eq 0 ]; then
        return 0
    fi
    command -v sudo >/dev/null 2>&1 || die "please run as root (sudo not found)"
    log "Not running as root — re-executing with sudo..."
    if [ -r "$0" ] && grep -q "PolySIEM native VM installer" "$0" 2>/dev/null; then
        exec sudo -E bash "$0" "$@"
    fi
    tmp_self="$(mktemp /tmp/polysiem-install-vm.XXXXXX)"
    repo_slug="${POLYSIEM_REPO#https://github.com/}"; repo_slug="${repo_slug%.git}"
    curl -fsSL "https://github.com/${repo_slug}/releases/latest/download/install-vm.sh" -o "$tmp_self" \
        || die "could not re-download installer for sudo re-exec"
    exec sudo -E bash "$tmp_self" "$@"
}

load_release_ref() {
    [ -n "$POLYSIEM_REF" ] && return 0
    manifest="$(mktemp /tmp/polysiem-release.XXXXXX)"
    curl -fsSL "${RELEASE_BASE}/release-manifest.json" -o "$manifest" \
        || die "could not download release-manifest.json"
    version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1)"
    rm -f "$manifest"
    case "$version" in
        [0-9]*.[0-9]*.[0-9]*) POLYSIEM_REF="v${version}" ;;
        *) die "the GitHub release manifest contains an invalid version" ;;
    esac
}

check_apt() {
    command -v apt-get >/dev/null 2>&1 \
        || die "this native installer supports Debian/Ubuntu (apt) only. Use the Docker installer (deploy/install.sh) on other systems."
}

install_packages() {
    export DEBIAN_FRONTEND=noninteractive
    log "Installing base packages (curl, git, OpenSSH client, ca-certificates, postgresql)..."
    apt-get update -qq
    apt-get install -y -qq curl git openssh-client ca-certificates gnupg sudo postgresql
    systemctl enable --now postgresql

    if command -v node >/dev/null 2>&1 && node -e 'process.exit(process.versions.node.split(".")[0] >= 22 ? 0 : 1)'; then
        log "Node $(node --version) already installed"
    else
        log "Installing Node.js 22 via NodeSource..."
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
        apt-get install -y -qq nodejs
    fi
    log "Using Node $(node --version), npm $(npm --version)"
}

create_user() {
    if id polysiem >/dev/null 2>&1; then
        log "System user 'polysiem' already exists"
    else
        log "Creating system user 'polysiem'..."
        useradd --system --home-dir "$BASE_DIR" --shell /usr/sbin/nologin polysiem
    fi
}

setup_database() {
    if [ -f "$ENV_FILE" ]; then
        log "Existing ${ENV_FILE} found — keeping database credentials"
        return 0
    fi
    command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets"
    DB_PASSWORD="$(openssl rand -hex 24)"
    if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='polysiem'" | grep -q 1; then
        log "PostgreSQL role 'polysiem' already exists — resetting its password"
        sudo -u postgres psql -qc "ALTER ROLE polysiem WITH PASSWORD '${DB_PASSWORD}'"
    else
        log "Creating PostgreSQL role 'polysiem'..."
        sudo -u postgres psql -qc "CREATE ROLE polysiem WITH LOGIN PASSWORD '${DB_PASSWORD}'"
    fi
    if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='polysiem'" | grep -q 1; then
        log "Database 'polysiem' already exists"
    else
        log "Creating database 'polysiem'..."
        sudo -u postgres createdb -O polysiem polysiem
    fi

    APP_SECRET="$(openssl rand -hex 32)"
    HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    HOST_IP="${HOST_IP:-localhost}"
    log "Writing ${ENV_FILE}..."
    mkdir -p "$BASE_DIR"
    cat > "$ENV_FILE" <<EOF
# PolySIEM configuration — generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by install-vm.sh
# BACK THIS FILE UP. APP_SECRET encrypts your integration credentials:
# if you lose it, you must re-enter them.
DATABASE_URL=postgresql://polysiem:${DB_PASSWORD}@localhost:5432/polysiem
APP_SECRET=${APP_SECRET}
APP_URL=http://${HOST_IP}:3000
POLYSIEM_GITHUB_REPOSITORY=${REPO_SLUG}
POLYSIEM_INSTALL_TYPE=native
EOF
    chmod 600 "$ENV_FILE"
    chown polysiem:polysiem "$ENV_FILE"
}

ensure_release_metadata() {
    if ! grep -q '^POLYSIEM_GITHUB_REPOSITORY=' "$ENV_FILE"; then
        printf '\nPOLYSIEM_GITHUB_REPOSITORY=%s\n' "$REPO_SLUG" >> "$ENV_FILE"
    fi
    if ! grep -q '^POLYSIEM_INSTALL_TYPE=' "$ENV_FILE"; then
        printf 'POLYSIEM_INSTALL_TYPE=native\n' >> "$ENV_FILE"
    fi
}

fetch_source() {
    mkdir -p "$BASE_DIR"
    if [ -d "${APP_DIR}/.git" ]; then
        log "Fetching release source (${POLYSIEM_REF})..."
        git -C "$APP_DIR" fetch --depth 1 origin "$POLYSIEM_REF"
        git -C "$APP_DIR" checkout -q --detach FETCH_HEAD
    else
        log "Cloning ${POLYSIEM_REPO} at ${POLYSIEM_REF}..."
        git clone --depth 1 --branch "$POLYSIEM_REF" "$POLYSIEM_REPO" "$APP_DIR"
    fi
}

build_app() {
    cd "$APP_DIR"
    log "Installing npm dependencies (npm ci)..."
    npm ci
    log "Generating Prisma client..."
    npx prisma generate
    log "Building PolySIEM (next build)..."
    SKIP_ENV_VALIDATION=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    APP_SECRET="build-secret-placeholder-32-characters" \
        npm run build
}

backup_existing_install() {
    [ -d "$RUN_DIR" ] || return 0

    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    BACKUP_DIR="${BACKUP_ROOT}/pre-update-${timestamp}"
    log "Stopping PolySIEM and creating pre-update backup at ${BACKUP_DIR}..."
    systemctl stop polysiem
    SERVICE_STOPPED_FOR_UPDATE=1
    mkdir -p "$BACKUP_DIR"
    chmod 700 "$BACKUP_ROOT" "$BACKUP_DIR"
    # The installer itself is root; only pg_dump is demoted to the postgres role.
    # shellcheck disable=SC2024
    sudo -u postgres pg_dump --format=custom --no-owner --no-privileges \
        polysiem > "${BACKUP_DIR}/polysiem.dump"
    [ -s "${BACKUP_DIR}/polysiem.dump" ]
    cp "$ENV_FILE" "${BACKUP_DIR}/.env"
    cp -a "$RUN_DIR" "${BACKUP_DIR}/run"
    chmod 600 "${BACKUP_DIR}/polysiem.dump" "${BACKUP_DIR}/.env"
    ROLLBACK_ARMED=1
}

restore_native_install() {
    ROLLING_BACK=1
    set +e
    warn "Update failed; restoring the pre-update database and runtime..."
    systemctl stop polysiem >/dev/null 2>&1
    sudo -u postgres psql -v ON_ERROR_STOP=1 -d polysiem \
        -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION polysiem;' >/dev/null
    db_status=$?
    if [ "$db_status" -eq 0 ]; then
        sudo -u postgres pg_restore --exit-on-error --no-owner --no-privileges \
            -d polysiem "${BACKUP_DIR}/polysiem.dump"
        db_status=$?
    fi
    rm -rf "$RUN_DIR"
    cp -a "${BACKUP_DIR}/run" "$RUN_DIR"
    chown -R polysiem:polysiem "$RUN_DIR"
    systemctl start polysiem

    if [ "$db_status" -eq 0 ] && wait_for_health; then
        warn "Rollback complete. PolySIEM is healthy on the previous runtime."
        warn "The failed update backup is preserved at ${BACKUP_DIR}."
        return 0
    fi
    warn "Automatic rollback did not complete cleanly. Keep ${BACKUP_DIR} and inspect journalctl -u polysiem -e."
    return 1
}

# shellcheck disable=SC2329 # invoked indirectly by the ERR trap below
on_error() {
    status=$?
    if [ "$ROLLBACK_ARMED" -eq 1 ] && [ "$ROLLING_BACK" -eq 0 ]; then
        restore_native_install || true
    elif [ "$SERVICE_STOPPED_FOR_UPDATE" -eq 1 ]; then
        systemctl start polysiem || true
    fi
    exit "$status"
}
trap 'on_error' ERR

migrate_db() {
    cd "$APP_DIR"
    log "Applying database migrations..."
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
    npx prisma migrate deploy
}

assemble_runtime() {
    log "Assembling runtime directory ${RUN_DIR}..."
    rm -rf "$RUN_DIR"
    mkdir -p "$RUN_DIR"
    cp -a "${APP_DIR}/.next/standalone/." "$RUN_DIR/"
    mkdir -p "${RUN_DIR}/.next"
    cp -a "${APP_DIR}/.next/static" "${RUN_DIR}/.next/static"
    cp -a "${APP_DIR}/public" "${RUN_DIR}/public"
    cp -a "${APP_DIR}/prisma" "${RUN_DIR}/prisma"
    chown -R polysiem:polysiem "$BASE_DIR"
}

install_service() {
    log "Installing systemd service..."
    cp "${APP_DIR}/deploy/polysiem.service" /etc/systemd/system/polysiem.service
    systemctl daemon-reload
    systemctl enable polysiem >/dev/null 2>&1
    systemctl restart polysiem
}

wait_for_health() {
    log "Waiting for PolySIEM to become healthy (up to 90s)..."
    i=0
    while [ "$i" -lt 45 ]; do
        if curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then
            return 0
        fi
        i=$((i + 1))
        sleep 2
    done
    return 1
}

success_box() {
    HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    HOST_IP="${HOST_IP:-localhost}"
    cat <<EOF

 ==============================================================
  PolySIEM is up and running (native install)!

  Open:        http://${HOST_IP}:3000
  Next step:   the setup wizard in your browser creates the
               first admin account — no CLI steps needed.

  Data:
    Config     ${ENV_FILE}  (back this up! APP_SECRET encrypts
               integration credentials)
    Database   local PostgreSQL, database 'polysiem'
    App        ${APP_DIR} (source), ${RUN_DIR} (runtime)

  Service:     systemctl status polysiem
  Logs:        journalctl -u polysiem -f
  Update:      re-run this installer (build, backup, migrate,
               health check, automatic rollback on failure)
  Backups:     ${BACKUP_ROOT}/pre-update-<UTC timestamp>
 ==============================================================

EOF
}

main() {
    require_root "$@"
    check_apt
    install_packages
    create_user
    setup_database
    ensure_release_metadata
    load_release_ref
    fetch_source
    build_app
    backup_existing_install
    migrate_db
    assemble_runtime
    install_service
    if wait_for_health; then
        ROLLBACK_ARMED=0
        success_box
    else
        warn "PolySIEM did not report healthy within 90s."
        if [ "$ROLLBACK_ARMED" -eq 1 ]; then
            restore_native_install || true
        fi
        exit 1
    fi
}

main "$@"
