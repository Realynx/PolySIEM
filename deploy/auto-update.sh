#!/usr/bin/env bash
# Host-side automatic update poller for managed Linux Docker installations.
# The application only exposes update intent; this root-owned process retains
# Docker access and delegates all changes to the transactional updater.
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/polysiem}"
ENV_FILE="${INSTALL_DIR}/.env"
UPDATE_ENDPOINT="${POLYSIEM_UPDATE_ENDPOINT:-http://127.0.0.1:3000/api/internal/auto-update}"
FAILED_VERSION_FILE="${INSTALL_DIR}/.auto-update-failed-version"
AUTO_CHECK_STAMP="${INSTALL_DIR}/.auto-update-last-check"

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

report_request_status() {
    [ -n "${request_id:-}" ] || return 0
    status="$1"
    message="$2"
    curl -fsSkL --max-time 30 \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        --data-urlencode "requestId=${request_id}" \
        --data-urlencode "status=${status}" \
        --data-urlencode "message=${message}" \
        "$UPDATE_ENDPOINT" >/dev/null || warn "could not report ${status} status to PolySIEM"
    return 0
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

    # Poll frequently for browser requests, but ask GitHub about unattended
    # releases only every 15 minutes to stay within its unauthenticated limit.
    check_url="$UPDATE_ENDPOINT"
    auto_check_due=0
    if [[ ! -f "$AUTO_CHECK_STAMP" ]] \
        || ! find "$AUTO_CHECK_STAMP" -mmin -15 -print -quit | grep -q .; then
        check_url="${UPDATE_ENDPOINT}?check=true"
        auto_check_due=1
    fi

    # -kL: follow the HTTP->HTTPS redirect (same host, so the Authorization
    # header is preserved) and accept the self-signed certificate.
    response="$(curl -fsSkL --max-time 30 \
        -H "Authorization: Bearer ${token}" \
        "$check_url")" || {
        warn "could not query PolySIEM update status"
        return 1
    }
    if [[ "$auto_check_due" -eq 1 ]]; then
        touch "$AUTO_CHECK_STAMP"
        chmod 600 "$AUTO_CHECK_STAMP"
    fi

    [[ "$(response_value capable)" == "true" ]] || return 0
    manual_requested="$(response_value manualRequested)"
    if [[ "$manual_requested" != "true" ]]; then
        [[ "$(response_value enabled)" == "true" ]] || return 0
        [[ "$(response_value updateAvailable)" == "true" ]] || return 0
    fi

    latest_version="$(response_value latestVersion)"
    if [[ ! "$latest_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        warn "the update endpoint returned an invalid release version"
        return 1
    fi
    if [[ "$manual_requested" != "true" ]] \
        && [[ -f "$FAILED_VERSION_FILE" ]] \
        && [[ "$(<"$FAILED_VERSION_FILE")" == "$latest_version" ]]; then
        warn "v${latest_version} previously failed automatic update; waiting for manual intervention or a newer release"
        return 0
    fi

    request_id=""
    if [[ "$manual_requested" == "true" ]]; then
        request_id="$(response_value requestId)"
        if [[ ! "$request_id" =~ ^[A-Za-z0-9-]{16,64}$ ]]; then
            warn "the update endpoint returned an invalid request id"
            return 1
        fi
        report_request_status "installing" "Creating a backup and installing v${latest_version}."
    fi

    log "v${latest_version} is available; starting transactional update"
    if env INSTALL_DIR="$INSTALL_DIR" "${INSTALL_DIR}/update.sh"; then
        rm -f "$FAILED_VERSION_FILE"
        report_request_status "completed" "The update completed and PolySIEM passed its health check."
        log "automatic update to v${latest_version} completed"
        return 0
    fi

    printf '%s\n' "$latest_version" > "$FAILED_VERSION_FILE"
    chmod 600 "$FAILED_VERSION_FILE"
    report_request_status "failed" "The update failed and the previous release was restored. Inspect the host updater logs before retrying."
    warn "automatic update to v${latest_version} failed; this version will not be retried automatically"
    return 1
}

main "$@"
