#!/usr/bin/env bash
# Host-side automatic update poller for managed Linux Docker installations.
# The application only exposes update intent; this root-owned process retains
# Docker access and delegates all changes to the transactional updater.
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/polysiem}"
ENV_FILE="${INSTALL_DIR}/.env"
UPDATE_ENDPOINT="${POLYSIEM_UPDATE_ENDPOINT:-http://127.0.0.1:3000/api/internal/auto-update}"
FAILED_VERSION_FILE="${INSTALL_DIR}/.auto-update-failed-version"

log() { printf '\033[1;36m[polysiem-auto-update]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[polysiem-auto-update]\033[0m %s\n' "$*" >&2; }

read_env_value() {
    key="$1"
    value="$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1)"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    printf '%s' "$value"
}

response_value() {
    key="$1"
    printf '%s\n' "$response" | sed -n "s/^${key}=//p" | tail -n 1
}

main() {
    if [[ ! -f "$ENV_FILE" || ! -x "${INSTALL_DIR}/update.sh" ]]; then
        warn "managed installation files are missing under ${INSTALL_DIR}"
        return 1
    fi

    token="$(read_env_value POLYSIEM_UPDATE_AGENT_TOKEN)"
    if [[ -z "$token" ]]; then
        warn "POLYSIEM_UPDATE_AGENT_TOKEN is missing; automatic updates remain disabled"
        return 1
    fi

    response="$(curl -fsS --max-time 30 \
        -H "Authorization: Bearer ${token}" \
        "$UPDATE_ENDPOINT")" || {
        warn "could not query PolySIEM update status"
        return 1
    }

    [[ "$(response_value enabled)" == "true" ]] || return 0
    [[ "$(response_value capable)" == "true" ]] || return 0
    [[ "$(response_value updateAvailable)" == "true" ]] || return 0

    latest_version="$(response_value latestVersion)"
    if [[ ! "$latest_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        warn "the update endpoint returned an invalid release version"
        return 1
    fi
    if [[ -f "$FAILED_VERSION_FILE" ]] \
        && [[ "$(<"$FAILED_VERSION_FILE")" == "$latest_version" ]]; then
        warn "v${latest_version} previously failed automatic update; waiting for manual intervention or a newer release"
        return 0
    fi

    log "v${latest_version} is available; starting transactional update"
    if env INSTALL_DIR="$INSTALL_DIR" "${INSTALL_DIR}/update.sh"; then
        rm -f "$FAILED_VERSION_FILE"
        log "automatic update to v${latest_version} completed"
        return 0
    fi

    printf '%s\n' "$latest_version" > "$FAILED_VERSION_FILE"
    chmod 600 "$FAILED_VERSION_FILE"
    warn "automatic update to v${latest_version} failed; this version will not be retried automatically"
    return 1
}

main "$@"
