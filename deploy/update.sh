#!/usr/bin/env bash
#
# PolySIEM transactional updater — Docker deployment.
#
# Creates a logical PostgreSQL dump and copies .env/docker-compose.yml before
# the new app runs migrations. If the new version does not become healthy, the
# database, compose file, and previous app image are restored automatically.
#
# Usage: sudo /opt/polysiem/update.sh
#   INSTALL_DIR overrides the install location (default: /opt/polysiem)
#   HEALTH_URL overrides the local health endpoint
#
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/polysiem}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"
BACKUP_ROOT="${BACKUP_ROOT:-${INSTALL_DIR}/backups}"
ROLLBACK_ARMED=0
ROLLING_BACK=0
BACKUP_DIR=""
ROLLBACK_IMAGE=""

log()  { printf '\033[1;36m[polysiem]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[polysiem]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[polysiem] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

require_root() {
    if [ "$(id -u)" -eq 0 ]; then
        return 0
    fi
    command -v sudo >/dev/null 2>&1 || die "please run this updater as root (sudo not found)"
    exec sudo -E env INSTALL_DIR="$INSTALL_DIR" HEALTH_URL="$HEALTH_URL" BACKUP_ROOT="$BACKUP_ROOT" bash "$0" "$@"
}

wait_for_health() {
    attempts="${1:-45}"
    i=0
    while [ "$i" -lt "$attempts" ]; do
        # -kL: follow the HTTP->HTTPS redirect and accept the self-signed cert.
        if curl -fsSkL "$HEALTH_URL" >/dev/null 2>&1; then
            return 0
        fi
        i=$((i + 1))
        sleep 2
    done
    return 1
}

read_env_value() {
    key="$1"
    value="$(sed -n "s/^${key}=//p" "${INSTALL_DIR}/.env" | tail -n 1)"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    printf '%s' "$value"
}

repository_slug() {
    slug="${POLYSIEM_GITHUB_REPOSITORY:-$(read_env_value POLYSIEM_GITHUB_REPOSITORY)}"
    if [ -z "$slug" ]; then
        image="$(docker compose config --images 2>/dev/null | sed -n 's#^ghcr.io/\([^:]*\).*#\1#p' | head -n 1)"
        slug="$image"
    fi
    case "$slug" in
        */*) printf '%s' "$slug" ;;
        *) die "cannot determine the GitHub repository; set POLYSIEM_GITHUB_REPOSITORY=owner/repository in ${INSTALL_DIR}/.env" ;;
    esac
}

set_env_value() {
    key="$1"
    new_value="$2"
    env_candidate="$(mktemp "${INSTALL_DIR}/.env.XXXXXX")"
    awk -v key="$key" -v value="$new_value" '
        BEGIN { found = 0 }
        index($0, key "=") == 1 { print key "=" value; found = 1; next }
        { print }
        END { if (!found) print key "=" value }
    ' "${INSTALL_DIR}/.env" > "$env_candidate"
    chmod 600 "$env_candidate"
    mv "$env_candidate" "${INSTALL_DIR}/.env"
}

restore_previous_version() {
    ROLLING_BACK=1
    set +e
    warn "Update failed; restoring the pre-update database and app image..."

    docker compose stop polysiem >/dev/null 2>&1
    cp "${BACKUP_DIR}/docker-compose.yml" "${INSTALL_DIR}/docker-compose.yml"
    cp "${BACKUP_DIR}/.env" "${INSTALL_DIR}/.env"

    docker compose up -d db >/dev/null 2>&1
    db_ready=0
    i=0
    while [ "$i" -lt 30 ]; do
        if docker compose exec -T db pg_isready -U polysiem -d polysiem >/dev/null 2>&1; then
            db_ready=1
            break
        fi
        i=$((i + 1))
        sleep 2
    done

    restored=0
    if [ "$db_ready" -eq 1 ]; then
        if docker compose exec -T db psql -v ON_ERROR_STOP=1 -U polysiem -d polysiem \
            -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null \
            && docker compose exec -T db pg_restore --exit-on-error --no-owner --no-privileges \
                -U polysiem -d polysiem < "${BACKUP_DIR}/polysiem.dump"; then
            restored=1
        fi
    fi

    override_file="${BACKUP_DIR}/rollback-compose.yml"
    printf 'services:\n  polysiem:\n    image: %s\n' "$ROLLBACK_IMAGE" > "$override_file"
    POLYSIEM_IMAGE="$ROLLBACK_IMAGE" docker compose \
        -f "${INSTALL_DIR}/docker-compose.yml" -f "$override_file" \
        up -d --no-deps --force-recreate polysiem >/dev/null 2>&1

    if [ "$restored" -eq 1 ] && wait_for_health 45; then
        warn "Rollback complete. PolySIEM is healthy on the previous version."
        warn "The failed update backup is preserved at ${BACKUP_DIR}."
        return 0
    fi

    warn "Automatic rollback did not complete cleanly. Do not delete ${BACKUP_DIR}."
    warn "Inspect: cd ${INSTALL_DIR} && docker compose logs polysiem db"
    return 1
}

# shellcheck disable=SC2329 # invoked indirectly by the ERR trap below
on_error() {
    status=$?
    line="$1"
    if [ "$ROLLBACK_ARMED" -eq 1 ] && [ "$ROLLING_BACK" -eq 0 ]; then
        warn "Updater stopped unexpectedly at line ${line}."
        restore_previous_version || true
    fi
    exit "$status"
}
trap 'on_error $LINENO' ERR

main() {
    require_root "$@"
    command -v docker >/dev/null 2>&1 || die "Docker is not installed"
    command -v curl >/dev/null 2>&1 || die "curl is not installed"
    docker compose version >/dev/null 2>&1 || die "the Docker Compose plugin is not installed"
    [ -f "${INSTALL_DIR}/docker-compose.yml" ] \
        || die "no docker-compose.yml in ${INSTALL_DIR} — is PolySIEM installed there?"
    [ -f "${INSTALL_DIR}/.env" ] \
        || die "no .env in ${INSTALL_DIR}; refusing to update without the encryption secret"

    cd "$INSTALL_DIR"
    exec 9>"${INSTALL_DIR}/.update.lock"
    command -v flock >/dev/null 2>&1 || die "flock is required to prevent concurrent updates"
    flock -n 9 || die "another PolySIEM update is already running"

    current_image="$(docker compose images -q polysiem | head -n 1)"
    [ -n "$current_image" ] || die "the installed PolySIEM image could not be found"
    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    ROLLBACK_IMAGE="polysiem-rollback:${timestamp}"
    docker image tag "$current_image" "$ROLLBACK_IMAGE"

    BACKUP_DIR="${BACKUP_ROOT}/pre-update-${timestamp}"
    mkdir -p "$BACKUP_DIR"
    chmod 700 "$BACKUP_ROOT" "$BACKUP_DIR"
    cp "${INSTALL_DIR}/.env" "${BACKUP_DIR}/.env"
    cp "${INSTALL_DIR}/docker-compose.yml" "${BACKUP_DIR}/docker-compose.yml"
    chmod 600 "${BACKUP_DIR}/.env" "${BACKUP_DIR}/docker-compose.yml"

    log "Creating pre-update PostgreSQL backup..."
    docker compose up -d db >/dev/null
    i=0
    until docker compose exec -T db pg_isready -U polysiem -d polysiem >/dev/null 2>&1; do
        i=$((i + 1))
        [ "$i" -lt 30 ] || die "PostgreSQL did not become ready; no update was attempted"
        sleep 2
    done
    docker compose exec -T db pg_dump --format=custom --no-owner --no-privileges \
        -U polysiem -d polysiem > "${BACKUP_DIR}/polysiem.dump"
    [ -s "${BACKUP_DIR}/polysiem.dump" ] || die "database backup is empty; no update was attempted"
    chmod 600 "${BACKUP_DIR}/polysiem.dump"
    log "Backup saved to ${BACKUP_DIR}"

    # No writes may occur after this point without being represented in the
    # backup. Arm rollback before replacing compose or running migrations.
    docker compose stop polysiem >/dev/null
    ROLLBACK_ARMED=1

    slug="$(repository_slug)"
    release_base="https://github.com/${slug}/releases/latest/download"
    manifest_candidate="${BACKUP_DIR}/release-manifest.json"
    compose_candidate="${BACKUP_DIR}/docker-compose.next.yml"
    update_candidate="${BACKUP_DIR}/update.next.sh"
    auto_update_candidate="${BACKUP_DIR}/auto-update.next.sh"
    log "Downloading and validating the current deployment definition..."
    curl -fsSL "${release_base}/release-manifest.json" -o "$manifest_candidate"
    release_image="$(sed -n 's/.*"image"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest_candidate" | head -n 1)"
    case "$release_image" in
        ghcr.io/*:*) ;;
        *) warn "the GitHub release manifest contains an invalid container image"; false ;;
    esac
    curl -fsSL "${release_base}/docker-compose.yml" -o "$compose_candidate"
    curl -fsSL "${release_base}/update.sh" -o "$update_candidate"
    curl -fsSL "${release_base}/auto-update.sh" -o "$auto_update_candidate"
    docker compose --env-file "${INSTALL_DIR}/.env" -f "$compose_candidate" config -q
    cp "$compose_candidate" "${INSTALL_DIR}/docker-compose.yml"
    set_env_value "POLYSIEM_IMAGE" "$release_image"

    log "Pulling the latest PolySIEM image..."
    docker compose pull polysiem
    docker compose up -d db >/dev/null
    log "Starting the new version and applying migrations..."
    docker compose up -d --no-deps --force-recreate polysiem

    log "Waiting for PolySIEM to become healthy (up to 90s)..."
    if wait_for_health 45; then
        ROLLBACK_ARMED=0
        log "Update complete. PolySIEM is healthy."
        log "Pre-update backup: ${BACKUP_DIR}"
        log "Previous image retained as ${ROLLBACK_IMAGE}; remove it after you are satisfied."
        if ! cp "$update_candidate" "${INSTALL_DIR}/update.sh" \
            || ! chmod 700 "${INSTALL_DIR}/update.sh"; then
            warn "PolySIEM updated, but update.sh could not refresh itself."
        fi
        if ! cp "$auto_update_candidate" "${INSTALL_DIR}/auto-update.sh" \
            || ! chmod 700 "${INSTALL_DIR}/auto-update.sh"; then
            warn "PolySIEM updated, but auto-update.sh could not refresh itself."
        fi
        exit 0
    fi

    warn "The new version did not become healthy within 90 seconds."
    if restore_previous_version; then
        ROLLBACK_ARMED=0
        exit 1
    fi
    exit 1
}

main "$@"
