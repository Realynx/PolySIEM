#!/usr/bin/env bash
# Root-owned release poller for native locked-demo installations. It downloads
# and checksum-verifies the current installer, which performs the transactional
# database/runtime backup, migration, health check, and rollback.
set -Eeuo pipefail

BASE_DIR="${POLYSIEM_BASE_DIR:-/opt/polysiem}"
POLYSIEM_REPO="${POLYSIEM_REPO:-https://github.com/Realynx/PolySIEM}"
REPO_SLUG="${POLYSIEM_REPO#https://github.com/}"
REPO_SLUG="${REPO_SLUG%.git}"
RELEASE_BASE="https://github.com/${REPO_SLUG}/releases/latest/download"
VERSION_FILE="${BASE_DIR}/.installed-version"
FAILED_VERSION_FILE="${BASE_DIR}/.auto-update-failed-version"
DOWNLOAD_DIR=""

log()  { printf '\033[1;36m[polysiem-native-update]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[polysiem-native-update]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[polysiem-native-update] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

cleanup() {
    case "$DOWNLOAD_DIR" in
        /tmp/polysiem-native-update.*) rm -rf "$DOWNLOAD_DIR" ;;
    esac
}
trap cleanup EXIT

main() {
    [ "$(id -u)" -eq 0 ] || die "native automatic updates must run as root"
    [ -f "${BASE_DIR}/.env" ] || die "PolySIEM configuration is missing"
    if ! grep -qx 'POLYSIEM_DEMO_MODE=true' "${BASE_DIR}/.env" \
        || ! grep -qx 'POLYSIEM_DEMO_LOCKED=true' "${BASE_DIR}/.env"; then
        die "refusing automatic native update because locked demo mode is not enabled"
    fi

    DOWNLOAD_DIR="$(mktemp -d /tmp/polysiem-native-update.XXXXXX)"
    manifest_path="${DOWNLOAD_DIR}/release-manifest.json"
    checksum_path="${DOWNLOAD_DIR}/SHA256SUMS"
    installer_path="${DOWNLOAD_DIR}/install-vm.sh"

    curl -fsSL --retry 3 --retry-delay 2 "${RELEASE_BASE}/release-manifest.json" -o "$manifest_path" \
        || die "could not download the latest release manifest"
    latest_version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest_path" | head -n 1)"
    printf '%s' "$latest_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' \
        || die "the latest release manifest contains an invalid version"

    current_version=""
    if [ -f "$VERSION_FILE" ]; then
        current_version="$(tr -d '\r\n' < "$VERSION_FILE")"
    fi
    if [ "$current_version" = "$latest_version" ]; then
        log "PolySIEM ${latest_version} is already current"
        return 0
    fi
    if [ -f "$FAILED_VERSION_FILE" ] \
        && [ "$(tr -d '\r\n' < "$FAILED_VERSION_FILE")" = "$latest_version" ]; then
        warn "v${latest_version} previously failed; waiting for a newer release or manual repair"
        return 0
    fi

    curl -fsSL --retry 3 --retry-delay 2 "${RELEASE_BASE}/install-vm.sh" -o "$installer_path" \
        || die "could not download the native installer"
    curl -fsSL --retry 3 --retry-delay 2 "${RELEASE_BASE}/SHA256SUMS" -o "$checksum_path" \
        || die "could not download release checksums"
    expected_checksum="$(awk '$2 == "install-vm.sh" { print $1; exit }' "$checksum_path")"
    actual_checksum="$(sha256sum "$installer_path" | awk '{print $1}')"
    if [ "${#expected_checksum}" -ne 64 ] \
        || printf '%s' "$expected_checksum" | grep -q '[^0-9a-fA-F]' \
        || [ "$actual_checksum" != "$expected_checksum" ]; then
        die "checksum verification failed for install-vm.sh"
    fi

    log "v${latest_version} is available; starting transactional native update"
    if env POLYSIEM_REPO="$POLYSIEM_REPO" bash "$installer_path" --demo; then
        rm -f "$FAILED_VERSION_FILE"
        log "automatic update to v${latest_version} completed"
        return 0
    fi

    printf '%s\n' "$latest_version" > "$FAILED_VERSION_FILE"
    chmod 600 "$FAILED_VERSION_FILE"
    warn "automatic update to v${latest_version} failed; it will not be retried automatically"
    return 1
}

main "$@"
