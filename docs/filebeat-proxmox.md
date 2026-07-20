# Proxmox host logs → Elasticsearch (Filebeat)

This setup ships system logs from all Proxmox VE hosts into Elasticsearch using Filebeat's journald input, with its own 90-day (3-month) retention that's independent of everything else in the cluster.

## Hosts

`dixie`, `finny`, `phoenix`, `alice`, `zen` (the `poofycluster` nodes). Filebeat is pinned to 9.2.3 to match the Elasticsearch 9.2.3 cluster, and held with `apt-mark hold` so an apt upgrade doesn't drift it.

## Data model

| Object | Name | Notes |
|---|---|---|
| Data stream | `filebeat-proxmox-<agent.version>` (e.g. `filebeat-proxmox-9.2.3`) | separate from the shared `filebeat-*` streams so retention is independent |
| Index template | `filebeat-proxmox` | priority 200, `composed_of: [ecs@mappings]`, data-stream enabled |
| ILM policy | `proxmox-logs-90d` | **hot:** rollover at 30d / 50 GB · **delete:** at 90d |
| Writer role | `filebeat_proxmox_writer` | `create_doc`/`create_index`/`auto_configure` on `filebeat-proxmox-*` only |
| Writer user | `filebeat_proxmox` | dedicated; password lives in each host's filebeat keystore |

PolySIEM's existing read-only ES API key is scoped to `filebeat-*`, which already covers `filebeat-proxmox-*`. These logs are queryable from PolySIEM without touching any credentials.

## Retention math

Rollover happens every 30 days or at 50 GB, whichever comes first, so up to about three backing indices are alive at once. Each one is deleted 90 days after it rolled over, which means the window holds roughly 90 days of logs at all times. To tune it, edit `RETENTION_DAYS`, `ROLLOVER_AGE`, and `ROLLOVER_SIZE` in `es-setup.sh` and re-run it.

## Why journald (single source)

Debian 12+/PVE 8+ keep system logs in the systemd journal only; there is no `/var/log/syslog` or `/var/log/auth.log` anymore. Filebeat reads the journal directly with a single `journald` input, which picks up syslog, auth (sshd/sudo), kernel, systemd, and every `pve*`/`corosync`/`pmxcfs` daemon from one place, with no rsyslog/file double-ingest.

## The mapping gotcha (important — do not "simplify" away)

`ecs@mappings` ships a dynamic template called `ecs_date` that maps any field named `*_timestamp` to type `date`. The journald input emits `journald.custom.syslog_timestamp` containing the raw syslog text (e.g. `"Jul 17 09:49:50 "`), which fails date parsing, and when that happens Elasticsearch rejects the entire document. The symptom is nasty to diagnose: native-journal events (systemd) index fine, while every syslog-transport event (sshd, cron, pve daemons) is silently dropped. Two guards are in place, and both stay:

1. `filebeat.proxmox.yml` drops `journald.custom.syslog_timestamp` (it's redundant with `@timestamp`). This is the effective fix.
2. The template sets `date_detection: false` and maps `journald.custom.*` to keyword. This is defense-in-depth only; it can't override `ecs_date`, because dynamic templates from composed components are evaluated first.

## Files

- `deploy/filebeat/es-setup.sh` — one-time ES setup (ILM, template, role, user). Run once from a workstation with superuser creds.
- `deploy/filebeat/filebeat.proxmox.yml` — canonical host config (journald input, keystore auth, ILM/template management off).
- `deploy/filebeat/install-proxmox-filebeat.sh` — idempotent per-host installer.

## Install / add a host

```bash
# 1) once, against the cluster (creates ILM/template/role/user, prints ES_PWD):
ES_URL=https://10.0.3.16:9200 ES_SUPERUSER=elastic ES_SUPERPASS='***' \
  deploy/filebeat/es-setup.sh

# 2) per host (re-runnable):
scp deploy/filebeat/filebeat.proxmox.yml deploy/filebeat/install-proxmox-filebeat.sh newhost:/tmp/
ssh newhost "ES_PWD='<writer-pass>' bash /tmp/install-proxmox-filebeat.sh"
```

The superuser password is only used in step 1, from your workstation. The hosts authenticate as `filebeat_proxmox` via their keystore and never store it.

## Viewing the logs

- **Kibana** (http://logs.fox:5601): add or pick the `filebeat-proxmox-*` data view, then filter by `host.name`, `log.syslog.appname` (sshd, pvedaemon, pmxcfs, …), `tags: pve`, or `log.syslog.priority`.
- **PolySIEM**: already covered by the existing `filebeat-*` read key. To surface these logs in the in-app log viewer, point (or add) an Elasticsearch integration index pattern at `filebeat-proxmox-*` in Settings → Integrations. That part is left to the operator; this rollout did not modify PolySIEM integration settings.

## Hardening follow-ups

- **TLS**: hosts currently use `ssl.verification_mode: none` because the cluster cert is self-signed. Better to pin the CA instead: ship the cert and set `ssl.certificate_authorities`.
- **/var/log/pve/tasks**: task lifecycle is already captured via journald (pvedaemon logs "starting/end task UPID…"). The raw per-task output files are not shipped since they're noisy and unstructured; add a `filestream` input if you want them.
