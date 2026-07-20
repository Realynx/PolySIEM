#!/usr/bin/env bash
#
# PolySIEM native VM installer (Debian/Ubuntu — e.g. a Proxmox VM or LXC).
#
# x86-64 installs use the checksum-verified standalone bundle published with
# each release. Other architectures and --source installs build from source.
#
# Usage:
#   curl -fsSL https://github.com/Realynx/PolySIEM/releases/latest/download/install-vm.sh | bash
#   curl -fsSL https://github.com/Realynx/PolySIEM/releases/latest/download/install-vm.sh | bash -s -- --demo
#   curl -fsSL https://github.com/Realynx/PolySIEM/releases/latest/download/install-vm.sh | bash -s -- --source
#
# Options:
#   --demo    provision a locked, read-only demo with login demo / demo
#   --source  build the selected release from source instead of using a bundle
#   --force   reinstall even when the selected release is already healthy
#   --uninstall
#             permanently remove PolySIEM, its database, config, and backups
#
# Environment overrides:
#   POLYSIEM_REPO    GitHub repository URL   (default: https://github.com/Realynx/PolySIEM)
#   POLYSIEM_REF     git tag/branch to build (implies --source)
#
# Layout:
#   /opt/polysiem/app   source checkout (only used by --source)
#   /opt/polysiem/run   active standalone runtime (what systemd runs)
#   /opt/polysiem/.env  configuration + secrets (BACK IT UP)
#
# Idempotent: re-running upgrades transactionally and skips an unchanged,
# healthy release unless --force is supplied.
#
set -Eeuo pipefail

POLYSIEM_REPO="${POLYSIEM_REPO:-https://github.com/Realynx/PolySIEM}"
REPO_SLUG="${POLYSIEM_REPO#https://github.com/}"
REPO_SLUG="${REPO_SLUG%.git}"
RELEASE_BASE="https://github.com/${REPO_SLUG}/releases/latest/download"
POLYSIEM_REF="${POLYSIEM_REF:-${POLYSIEM_BRANCH:-}}"
CUSTOM_REF="$POLYSIEM_REF"
BASE_DIR="/opt/polysiem"
APP_DIR="${BASE_DIR}/app"
RUN_DIR="${BASE_DIR}/run"
ENV_FILE="${BASE_DIR}/.env"
VERSION_FILE="${BASE_DIR}/.installed-version"
BACKUP_ROOT="${BASE_DIR}/backups"
BACKUP_DIR=""
STAGED_RUNTIME=""
DOWNLOAD_DIR=""
RELEASE_VERSION=""
BUNDLE_ASSET=""
SOURCE_MODE=0
FORCE_INSTALL=0
UNINSTALL_MODE=0
DEMO_REQUESTED=0
DEMO_MODE=0
DEMO_CONFIG_CHANGED=0
ROLLBACK_ARMED=0
ROLLING_BACK=0
SERVICE_STOPPED_FOR_UPDATE=0

log()  { printf '\033[1;36m[polysiem]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[polysiem]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[polysiem] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --demo) DEMO_REQUESTED=1; DEMO_MODE=1 ;;
            --source) SOURCE_MODE=1 ;;
            --force) FORCE_INSTALL=1 ;;
            --uninstall) UNINSTALL_MODE=1 ;;
            -h|--help)
                sed -n '2,/^set -/s/^# \{0,1\}//p' "$0" 2>/dev/null || true
                exit 0
                ;;
            *) die "unknown option: $1 (supported: --demo, --source, --force, --uninstall)" ;;
        esac
        shift
    done
    if [ "$UNINSTALL_MODE" -eq 1 ]; then
        if [ "$DEMO_REQUESTED" -eq 1 ] || [ "$SOURCE_MODE" -eq 1 ] || [ "$FORCE_INSTALL" -eq 1 ]; then
            die "--uninstall cannot be combined with --demo, --source, or --force"
        fi
        return 0
    fi
    if [ -n "$CUSTOM_REF" ]; then
        SOURCE_MODE=1
    fi
}

detect_existing_install_mode() {
    [ -f "$ENV_FILE" ] || return 0

    if grep -qx 'POLYSIEM_DEMO_MODE=true' "$ENV_FILE" \
        && grep -qx 'POLYSIEM_DEMO_LOCKED=true' "$ENV_FILE"; then
        DEMO_MODE=1
        if [ "$DEMO_REQUESTED" -eq 0 ]; then
            log "Existing locked demo configuration found — preserving demo mode"
        fi
        return 0
    fi

    if [ "$DEMO_REQUESTED" -eq 1 ]; then
        die "--demo requires a fresh dedicated instance. This is an existing normal install; run --uninstall first if its data can be deleted."
    fi
}

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
    curl -fsSL "${RELEASE_BASE}/install-vm.sh" -o "$tmp_self" \
        || die "could not re-download installer for sudo re-exec"
    exec sudo -E bash "$tmp_self" "$@"
}

check_apt() {
    command -v apt-get >/dev/null 2>&1 \
        || die "this native installer supports Debian/Ubuntu (apt) only. Use the Docker installer on other systems."
}

select_install_mode() {
    [ "$SOURCE_MODE" -eq 1 ] && return 0
    case "$(uname -m)" in
        x86_64|amd64) ;;
        *)
            SOURCE_MODE=1
            warn "No native bundle is published for $(uname -m); falling back to a source build."
            ;;
    esac
}

install_packages() {
    export DEBIAN_FRONTEND=noninteractive
    packages="curl openssh-client ca-certificates gnupg sudo postgresql openssl libgomp1 tar"
    if [ "$SOURCE_MODE" -eq 1 ]; then
        packages="$packages git"
    fi

    missing_packages=""
    for package in $packages; do
        if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q '^install ok installed$'; then
            missing_packages="$missing_packages $package"
        fi
    done

    if [ -n "$missing_packages" ]; then
        log "Installing missing base packages:${missing_packages}..."
        apt-get update -qq
        # shellcheck disable=SC2086 # package names are the fixed list above
        apt-get install -y -qq --no-install-recommends $missing_packages
    else
        log "Required base packages are already installed"
    fi
    systemctl enable --now postgresql

    if command -v node >/dev/null 2>&1 \
        && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
        log "Node $(node --version) already installed"
    else
        log "Installing Node.js 22 via NodeSource..."
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
        apt-get install -y -qq --no-install-recommends nodejs
    fi
    log "Using Node $(node --version), npm $(npm --version)"
}

load_release_ref() {
    if [ -n "$POLYSIEM_REF" ]; then
        log "Using requested source ref ${POLYSIEM_REF}"
        return 0
    fi

    manifest="$(mktemp /tmp/polysiem-release.XXXXXX)"
    curl -fsSL "${RELEASE_BASE}/release-manifest.json" -o "$manifest" \
        || die "could not download release-manifest.json"
    RELEASE_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1)"
    manifest_bundle="$(sed -n 's/.*"nativeLinuxX64Bundle"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1)"
    rm -f "$manifest"

    if ! printf '%s' "$RELEASE_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
        die "the GitHub release manifest contains an invalid version"
    fi
    POLYSIEM_REF="v${RELEASE_VERSION}"

    BUNDLE_ASSET="${manifest_bundle:-polysiem-${RELEASE_VERSION}-standalone-linux-x64.tar.gz}"
    if [ "$BUNDLE_ASSET" != "polysiem-${RELEASE_VERSION}-standalone-linux-x64.tar.gz" ]; then
        die "the GitHub release manifest contains an invalid native Linux bundle"
    fi
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

set_env_value() {
    key="$1"
    value="$2"
    if grep -qx "${key}=${value}" "$ENV_FILE"; then
        return 0
    fi
    if grep -q "^${key}=" "$ENV_FILE"; then
        sed -i "s/^${key}=.*/${key}=${value}/" "$ENV_FILE"
    else
        printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi
    DEMO_CONFIG_CHANGED=1
}

configure_demo_mode() {
    [ "$DEMO_MODE" -eq 1 ] || return 0

    log "Configuring immutable public demo (login: demo / demo)..."
    set_env_value POLYSIEM_DEMO_MODE true
    set_env_value POLYSIEM_DEMO_LOCKED true
    set_env_value POLYSIEM_DEMO_AUTO_SETUP true
    set_env_value POLYSIEM_DEMO_USERNAME demo
    set_env_value POLYSIEM_DEMO_PASSWORD demo
    set_env_value POLYSIEM_DEMO_PROFILE security-incident
    set_env_value POLYSIEM_DEMO_SEED native-public-demo
    set_env_value POLYSIEM_DEMO_SIZE 3
    set_env_value MOCK_AI true
    set_env_value POLYSIEM_AUTO_UPDATE_CAPABLE true
    chmod 600 "$ENV_FILE"
    chown polysiem:polysiem "$ENV_FILE"
}

install_demo_auto_update_timer() {
    [ "$DEMO_MODE" -eq 1 ] || return 0

    log "Installing enforced automatic updates for the locked demo..."
    curl -fsSL "${RELEASE_BASE}/native-auto-update.sh" -o "${BASE_DIR}/native-auto-update.sh" \
        || die "could not download native-auto-update.sh"
    chown root:root "${BASE_DIR}/native-auto-update.sh"
    chmod 700 "${BASE_DIR}/native-auto-update.sh"

    cat > /etc/systemd/system/polysiem-native-auto-update.service <<EOF
[Unit]
Description=PolySIEM native locked-demo automatic update
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=oneshot
Environment=POLYSIEM_REPO=${POLYSIEM_REPO}
ExecStart=${BASE_DIR}/native-auto-update.sh
EOF
    cat > /etc/systemd/system/polysiem-native-auto-update.timer <<'EOF'
[Unit]
Description=Check for verified PolySIEM native demo releases

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min
RandomizedDelaySec=2min
Persistent=true

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now polysiem-native-auto-update.timer >/dev/null
}

ensure_release_metadata() {
    if ! grep -q '^POLYSIEM_GITHUB_REPOSITORY=' "$ENV_FILE"; then
        printf '\nPOLYSIEM_GITHUB_REPOSITORY=%s\n' "$REPO_SLUG" >> "$ENV_FILE"
    fi
    if ! grep -q '^POLYSIEM_INSTALL_TYPE=' "$ENV_FILE"; then
        printf 'POLYSIEM_INSTALL_TYPE=native\n' >> "$ENV_FILE"
    fi
}

current_release_is_healthy() {
    [ "$SOURCE_MODE" -eq 0 ] || return 1
    [ "$FORCE_INSTALL" -eq 0 ] || return 1
    [ "$DEMO_CONFIG_CHANGED" -eq 0 ] || return 1
    [ -f "$VERSION_FILE" ] || return 1
    [ "$(tr -d '\r\n' < "$VERSION_FILE")" = "$RELEASE_VERSION" ] || return 1
    [ -f "${RUN_DIR}/server.js" ] || return 1
    systemctl is-active --quiet polysiem || return 1
    if [ "$DEMO_MODE" -eq 1 ]; then
        [ -x "${BASE_DIR}/native-auto-update.sh" ] || return 1
        systemctl is-enabled --quiet polysiem-native-auto-update.timer || return 1
    fi
    curl -fsS http://localhost:3000/api/health >/dev/null 2>&1
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

prepare_source_runtime() {
    fetch_source
    cd "$APP_DIR"
    log "Installing npm dependencies for the source build..."
    ONNXRUNTIME_NODE_INSTALL=skip npm ci --no-audit --no-fund
    log "Generating Prisma client..."
    npx --no-install prisma generate
    log "Building PolySIEM (next build)..."
    SKIP_ENV_VALIDATION=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    APP_SECRET="build-secret-placeholder-32-characters" \
        npm run build

    STAGED_RUNTIME="$(mktemp -d "${BASE_DIR}/.run-next.XXXXXX")"
    cp -a "${APP_DIR}/.next/standalone/." "$STAGED_RUNTIME/"
    mkdir -p "${STAGED_RUNTIME}/.next"
    cp -a "${APP_DIR}/.next/static" "${STAGED_RUNTIME}/.next/static"
    cp -a "${APP_DIR}/public" "${STAGED_RUNTIME}/public"
    cp -a "${APP_DIR}/prisma" "${STAGED_RUNTIME}/prisma"
    cp "${APP_DIR}/deploy/polysiem.service" "${STAGED_RUNTIME}/polysiem.service"
}

prepare_bundle_runtime() {
    exact_release_base="https://github.com/${REPO_SLUG}/releases/download/v${RELEASE_VERSION}"
    DOWNLOAD_DIR="$(mktemp -d /tmp/polysiem-runtime.XXXXXX)"
    bundle_path="${DOWNLOAD_DIR}/${BUNDLE_ASSET}"
    checksum_path="${DOWNLOAD_DIR}/SHA256SUMS"

    log "Downloading prebuilt PolySIEM ${RELEASE_VERSION} runtime..."
    curl -fL --retry 3 --retry-delay 2 "${exact_release_base}/${BUNDLE_ASSET}" -o "$bundle_path" \
        || die "could not download ${BUNDLE_ASSET}"
    curl -fL --retry 3 --retry-delay 2 "${exact_release_base}/SHA256SUMS" -o "$checksum_path" \
        || die "could not download release checksums"

    expected_checksum="$(awk -v asset="$BUNDLE_ASSET" '$2 == asset { print $1; exit }' "$checksum_path")"
    actual_checksum="$(sha256sum "$bundle_path" | awk '{print $1}')"
    if [ "${#expected_checksum}" -ne 64 ] \
        || printf '%s' "$expected_checksum" | grep -q '[^0-9a-fA-F]' \
        || [ "$actual_checksum" != "$expected_checksum" ]; then
        die "checksum verification failed for ${BUNDLE_ASSET}"
    fi
    log "Release bundle checksum verified"

    mkdir -p "$BASE_DIR"
    STAGED_RUNTIME="$(mktemp -d "${BASE_DIR}/.run-next.XXXXXX")"
    tar -xzf "$bundle_path" -C "$STAGED_RUNTIME" --strip-components=1 --no-same-owner
    [ -f "${STAGED_RUNTIME}/server.js" ] || die "release bundle is missing server.js"
    [ -x "${STAGED_RUNTIME}/prisma-cli/node_modules/.bin/prisma" ] \
        || die "release bundle is missing the Prisma CLI"
    [ -f "${STAGED_RUNTIME}/prisma/schema.prisma" ] \
        || die "release bundle is missing the Prisma schema"
    [ -f "${STAGED_RUNTIME}/node_modules/.prisma/client/libquery_engine-debian-openssl-1.1.x.so.node" ] \
        || die "release bundle is missing the Prisma OpenSSL 1.1 query engine"
    [ -f "${STAGED_RUNTIME}/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node" ] \
        || die "release bundle is missing the Prisma OpenSSL 3 query engine"
    [ -f "${STAGED_RUNTIME}/polysiem.service" ] \
        || die "release bundle is missing the systemd service"
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
    if [ -f /etc/systemd/system/polysiem.service ]; then
        cp /etc/systemd/system/polysiem.service "${BACKUP_DIR}/polysiem.service"
    fi
    chmod 600 "${BACKUP_DIR}/polysiem.dump" "${BACKUP_DIR}/.env"
    ROLLBACK_ARMED=1
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
    if [ -f "${BACKUP_DIR}/polysiem.service" ]; then
        install -m 0644 "${BACKUP_DIR}/polysiem.service" /etc/systemd/system/polysiem.service
        systemctl daemon-reload
    fi
    systemctl start polysiem

    if [ "$db_status" -eq 0 ] && wait_for_health; then
        warn "Rollback complete. PolySIEM is healthy on the previous runtime."
        warn "The failed update backup is preserved at ${BACKUP_DIR}."
        return 0
    fi
    warn "Automatic rollback did not complete cleanly. Keep ${BACKUP_DIR} and inspect journalctl -u polysiem -e."
    return 1
}

uninstall_native() {
    warn "Uninstalling PolySIEM permanently (database, config, runtime, and backups)..."
    systemctl disable --now polysiem-native-auto-update.timer >/dev/null 2>&1 || true
    systemctl disable --now polysiem >/dev/null 2>&1 || true

    if command -v psql >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
        postgres_was_active=0
        if systemctl is-active --quiet postgresql; then
            postgres_was_active=1
        else
            log "Starting PostgreSQL temporarily to remove the PolySIEM database..."
            systemctl start postgresql
        fi

        database_cleanup_status=0
        sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres \
            -c 'DROP DATABASE IF EXISTS polysiem WITH (FORCE);' >/dev/null \
            || database_cleanup_status=$?
        if [ "$database_cleanup_status" -eq 0 ]; then
            sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres \
                -c 'DROP ROLE IF EXISTS polysiem;' >/dev/null \
                || database_cleanup_status=$?
        fi

        if [ "$postgres_was_active" -eq 0 ]; then
            systemctl stop postgresql
        fi
        [ "$database_cleanup_status" -eq 0 ] \
            || die "could not remove the PolySIEM database; installation files were preserved"
    else
        warn "PostgreSQL is not installed; skipping database and role removal."
    fi

    rm -f /etc/systemd/system/polysiem.service
    rm -f /etc/systemd/system/polysiem-native-auto-update.service
    rm -f /etc/systemd/system/polysiem-native-auto-update.timer
    systemctl daemon-reload
    systemctl reset-failed polysiem >/dev/null 2>&1 || true

    if id polysiem >/dev/null 2>&1; then
        userdel polysiem
    fi

    case "$BASE_DIR" in
        /opt/polysiem) rm -rf -- "$BASE_DIR" ;;
        *) die "refusing to remove unexpected install directory: ${BASE_DIR}" ;;
    esac

    log "PolySIEM was uninstalled. Shared Node.js and PostgreSQL packages were left installed."
}

cleanup() {
    case "$DOWNLOAD_DIR" in
        /tmp/polysiem-runtime.*) rm -rf "$DOWNLOAD_DIR" ;;
    esac
    case "$STAGED_RUNTIME" in
        "${BASE_DIR}"/.run-next.*) rm -rf "$STAGED_RUNTIME" ;;
    esac
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
trap 'cleanup' EXIT

migrate_db() {
    log "Applying database migrations..."
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
    if [ "$SOURCE_MODE" -eq 1 ]; then
        "${APP_DIR}/node_modules/.bin/prisma" migrate deploy --schema "${APP_DIR}/prisma/schema.prisma"
    else
        "${STAGED_RUNTIME}/prisma-cli/node_modules/.bin/prisma" migrate deploy \
            --schema "${STAGED_RUNTIME}/prisma/schema.prisma"
    fi
}

activate_runtime() {
    log "Activating runtime at ${RUN_DIR}..."
    rm -rf "$RUN_DIR"
    mv "$STAGED_RUNTIME" "$RUN_DIR"
    STAGED_RUNTIME=""
    # mktemp creates the staging root as 0700. Keep the runtime root-owned, but
    # allow the unprivileged service account to traverse and read it.
    chown root:root "$BASE_DIR" "$RUN_DIR"
    chmod 0755 "$BASE_DIR" "$RUN_DIR"
}

install_service() {
    log "Installing systemd service..."
    install -m 0644 "${RUN_DIR}/polysiem.service" /etc/systemd/system/polysiem.service
    systemctl daemon-reload
    systemctl enable polysiem >/dev/null 2>&1
    systemctl restart polysiem
}

record_installed_version() {
    if [ "$SOURCE_MODE" -eq 1 ]; then
        printf 'source:%s\n' "$POLYSIEM_REF" > "$VERSION_FILE"
    else
        printf '%s\n' "$RELEASE_VERSION" > "$VERSION_FILE"
    fi
    chmod 644 "$VERSION_FILE"
}

success_box() {
    HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    HOST_IP="${HOST_IP:-localhost}"
    if [ "$SOURCE_MODE" -eq 1 ]; then
        update_description="source build, backup, migrate, health check, rollback"
    else
        update_description="verified bundle, backup, migrate, health check, rollback"
    fi
    if [ "$DEMO_MODE" -eq 1 ]; then
        next_step="Login:       demo / demo (locked read-only demo)
  Updates:     automatic, every 15 minutes"
    else
        next_step="Next step:   the setup wizard in your browser creates the
               first admin account — no CLI steps needed."
    fi
    cat <<EOF

 ==============================================================
  PolySIEM is up and running (native install)!

  Open:        http://${HOST_IP}:3000
  ${next_step}

  Data:
    Config     ${ENV_FILE}  (back this up! APP_SECRET encrypts
               integration credentials)
    Database   local PostgreSQL, database 'polysiem'
    Runtime    ${RUN_DIR}

  Service:     systemctl status polysiem
  Logs:        journalctl -u polysiem -f
  Update:      re-run this installer (${update_description})
  Backups:     ${BACKUP_ROOT}/pre-update-<UTC timestamp>
 ==============================================================

EOF
}

main() {
    parse_args "$@"
    require_root "$@"
    if [ "$UNINSTALL_MODE" -eq 1 ]; then
        uninstall_native
        exit 0
    fi
    check_apt
    detect_existing_install_mode
    select_install_mode
    install_packages
    load_release_ref

    create_user
    setup_database
    configure_demo_mode
    ensure_release_metadata

    if current_release_is_healthy; then
        log "PolySIEM ${RELEASE_VERSION} is already installed and healthy; nothing to do."
        success_box
        exit 0
    fi

    if [ "$SOURCE_MODE" -eq 1 ]; then
        prepare_source_runtime
    else
        prepare_bundle_runtime
    fi

    backup_existing_install
    migrate_db
    activate_runtime
    install_service
    if wait_for_health; then
        install_demo_auto_update_timer
        record_installed_version
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
