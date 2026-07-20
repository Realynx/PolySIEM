#!/usr/bin/env bash
# ============================================================================
# es-setup.sh — one-time Elasticsearch setup for Proxmox log shipping.
#
# Creates (idempotently):
#   * ILM policy      proxmox-logs-90d      (hot: rollover 30d/50gb, delete 90d)
#   * index template  filebeat-proxmox      (data stream, ecs@mappings, 90d ILM)
#   * role            filebeat_proxmox_writer
#   * user            filebeat_proxmox      (password from $FB_PROXMOX_PASS)
#
# The template disables dynamic date-detection and maps journald.custom.* to
# keyword. NOTE: ecs@mappings ships a dynamic template `ecs_date` that matches
# any *_timestamp field first, so the real guard against the journald syslog
# timestamp is the drop_fields processor in filebeat.proxmox.yml — keep both.
#
# Usage:
#   ES_URL=https://10.0.3.16:9200 \
#   ES_SUPERUSER=elastic ES_SUPERPASS='***' \
#   FB_PROXMOX_PASS='***' \        # writer password (generated if unset)
#   ./es-setup.sh
#
# Requires: curl, python3. Superuser creds are used ONLY here (policy/role/user
# creation); the hosts never see them — they authenticate as filebeat_proxmox.
# ============================================================================
set -euo pipefail

ES_URL="${ES_URL:-https://10.0.3.16:9200}"
ES_SUPERUSER="${ES_SUPERUSER:-elastic}"
ES_SUPERPASS="${ES_SUPERPASS:?set ES_SUPERPASS (Elasticsearch superuser password)}"
CURL_TLS="${CURL_TLS:--k}"   # self-signed cluster cert; set to '' to enforce verification
RETENTION_DAYS="${RETENTION_DAYS:-90}"
ROLLOVER_AGE="${ROLLOVER_AGE:-30d}"
ROLLOVER_SIZE="${ROLLOVER_SIZE:-50gb}"

if [[ -z "${FB_PROXMOX_PASS:-}" ]]; then
  FB_PROXMOX_PASS="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-28)"
  echo ">> generated filebeat_proxmox password: ${FB_PROXMOX_PASS}"
  echo ">> (store it in a password manager; the hosts keep it in the filebeat keystore)"
fi

es() { curl -sS ${CURL_TLS} -u "${ES_SUPERUSER}:${ES_SUPERPASS}" -H 'Content-Type: application/json' "$@"; }

echo "== 1/4 ILM policy proxmox-logs-${RETENTION_DAYS}d =="
es -X PUT "${ES_URL}/_ilm/policy/proxmox-logs-90d" -d "{
  \"policy\": { \"phases\": {
    \"hot\":    { \"min_age\": \"0ms\", \"actions\": { \"rollover\": { \"max_age\": \"${ROLLOVER_AGE}\", \"max_primary_shard_size\": \"${ROLLOVER_SIZE}\" }, \"set_priority\": { \"priority\": 100 } } },
    \"delete\": { \"min_age\": \"${RETENTION_DAYS}d\", \"actions\": { \"delete\": {} } }
  } }
}"; echo

echo "== 2/4 index template filebeat-proxmox (data stream + 90d ILM) =="
es -X PUT "${ES_URL}/_index_template/filebeat-proxmox" -d '{
  "index_patterns": ["filebeat-proxmox-*"],
  "data_stream": { "hidden": false, "allow_custom_routing": false },
  "priority": 200,
  "composed_of": ["ecs@mappings"],
  "template": {
    "settings": { "index": {
      "lifecycle": { "name": "proxmox-logs-90d" },
      "number_of_shards": "1",
      "number_of_replicas": "0",
      "refresh_interval": "5s",
      "mapping": { "total_fields": { "limit": "2000" } }
    } },
    "mappings": {
      "date_detection": false,
      "dynamic_templates": [
        { "journald_custom_keyword": { "path_match": "journald.custom.*", "mapping": { "type": "keyword", "ignore_above": 1024 } } }
      ],
      "properties": {
        "log_source": { "type": "keyword" },
        "cluster":    { "type": "keyword" }
      }
    }
  },
  "_meta": { "managed_by": "polysiem", "description": "Proxmox host logs via Filebeat journald, 90d retention" }
}'; echo

echo "== 3/4 writer role filebeat_proxmox_writer =="
es -X PUT "${ES_URL}/_security/role/filebeat_proxmox_writer" -d '{
  "cluster": ["monitor", "read_ilm"],
  "indices": [{ "names": ["filebeat-proxmox-*"], "privileges": ["create_doc","create_index","view_index_metadata","auto_configure"] }]
}'; echo

echo "== 4/4 writer user filebeat_proxmox =="
es -X PUT "${ES_URL}/_security/user/filebeat_proxmox" -d "{
  \"password\": \"${FB_PROXMOX_PASS}\",
  \"roles\": [\"filebeat_proxmox_writer\"],
  \"full_name\": \"Filebeat Proxmox writer\",
  \"metadata\": { \"managed_by\": \"polysiem\" }
}"; echo

echo
echo ">> Elasticsearch side ready. Export this for the host installer:"
echo "   export ES_PWD='${FB_PROXMOX_PASS}'"
