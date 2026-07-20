#!/usr/bin/env bash
# ============================================================================
# install-proxmox-filebeat.sh — idempotent Filebeat installer for ONE Proxmox
# host. Safe to re-run (upgrades config in place, never duplicates repo/service).
#
# Run ON the target host (as root), with the writer password in the env:
#   scp filebeat.proxmox.yml install-proxmox-filebeat.sh <host>:/tmp/
#   ssh <host> "ES_PWD='<writer-pass>' bash /tmp/install-proxmox-filebeat.sh"
#
# Expects filebeat.proxmox.yml to sit next to this script (or set CONFIG_SRC).
#
# Env:
#   ES_PWD       (required) password for the filebeat_proxmox ES user
#   FB_VERSION   filebeat version to pin  (default 9.2.3, matches ES 9.2.x)
#   CONFIG_SRC   path to filebeat.proxmox.yml (default: alongside this script)
# ============================================================================
set -euo pipefail

FB_VERSION="${FB_VERSION:-9.2.3}"
ES_PWD="${ES_PWD:?set ES_PWD (filebeat_proxmox writer password)}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_SRC="${CONFIG_SRC:-${HERE}/filebeat.proxmox.yml}"

[[ -f "${CONFIG_SRC}" ]] || { echo "ERROR: config not found at ${CONFIG_SRC}"; exit 1; }
command -v pveversion >/dev/null 2>&1 || echo "WARN: pveversion not found — is this a Proxmox host?"

echo "== [1/6] Elastic apt repo =="
if [[ ! -f /usr/share/keyrings/elastic-9x.gpg ]]; then
  curl -fsSL https://artifacts.elastic.co/GPG-KEY-elasticsearch | gpg --dearmor -o /usr/share/keyrings/elastic-9x.gpg
fi
echo "deb [signed-by=/usr/share/keyrings/elastic-9x.gpg] https://artifacts.elastic.co/packages/9.x/apt stable main" \
  > /etc/apt/sources.list.d/elastic-9.x.list
apt-get update -o Dir::Etc::sourcelist="sources.list.d/elastic-9.x.list" \
  -o Dir::Etc::sourceparts="-" -o APT::Get::List-Cleanup="0" >/dev/null

echo "== [2/6] install filebeat=${FB_VERSION} (held) =="
if ! filebeat version 2>/dev/null | grep -q "filebeat version ${FB_VERSION} "; then
  apt-mark unhold filebeat >/dev/null 2>&1 || true
  DEBIAN_FRONTEND=noninteractive apt-get install -y --allow-downgrades "filebeat=${FB_VERSION}"
fi
apt-mark hold filebeat >/dev/null
filebeat version

echo "== [3/6] deploy config =="
[[ -f /etc/filebeat/filebeat.yml && ! -f /etc/filebeat/filebeat.yml.stock.bak ]] \
  && cp /etc/filebeat/filebeat.yml /etc/filebeat/filebeat.yml.stock.bak || true
install -o root -g root -m 0600 "${CONFIG_SRC}" /etc/filebeat/filebeat.yml
mkdir -p /var/log/filebeat

echo "== [4/6] keystore (ES_PWD) =="
filebeat keystore create >/dev/null 2>&1 || true
printf '%s' "${ES_PWD}" | filebeat keystore add ES_PWD --stdin --force
unset ES_PWD

echo "== [5/6] validate =="
filebeat test config
filebeat test output

echo "== [6/6] enable + (re)start =="
systemctl reset-failed filebeat 2>/dev/null || true
systemctl enable --now filebeat
sleep 3
systemctl is-active filebeat
echo "OK: filebeat ${FB_VERSION} shipping to data stream filebeat-proxmox-${FB_VERSION} on $(hostname)"
