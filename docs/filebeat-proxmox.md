# Proxmox host logs → Elasticsearch (Filebeat)

Ships system logs from all Proxmox VE hosts into Elasticsearch with an
independent 90-day (3-month) retention, using **Filebeat's journald input**.

## Hosts

`dixie`, `finny`, `phoenix`, `alice`, `zen` (the `poofycluster` nodes). Filebeat
is pinned to **9.2.3** (matches the Elasticsearch 9.2.3 cluster) and `apt-mark hold`d.

## Data model

| Object | Name | Notes |
|---|---|---|
| Data stream | `filebeat-proxmox-<agent.version>` (e.g. `filebeat-proxmox-9.2.3`) | separate from the shared `filebeat-*` streams so retention is independent |
| Index template | `filebeat-proxmox` | priority 200, `composed_of: [ecs@mappings]`, data-stream enabled |
| ILM policy | `proxmox-logs-90d` | **hot:** rollover at 30d / 50 GB · **delete:** at 90d |
| Writer role | `filebeat_proxmox_writer` | `create_doc`/`create_index`/`auto_configure` on `filebeat-proxmox-*` only |
| Writer user | `filebeat_proxmox` | dedicated; password lives in each host's filebeat keystore |

`filebeat-proxmox-*` is already covered by PolySIEM's existing read-only ES API
key (scoped to `filebeat-*`), so these logs are queryable from PolySIEM without
any credential change.

## Retention math

Rollover every 30 days (or 50 GB, whichever comes first) → up to ~3 backing
indices alive at once; each is deleted 90 days after it was rolled over. So the
window holds ~90 days of logs at all times. Tune in `es-setup.sh`
(`RETENTION_DAYS`, `ROLLOVER_AGE`, `ROLLOVER_SIZE`) then re-run it.

## Why journald (single source)

Debian 12+/PVE 8+ keep system logs in the **systemd journal only** — there is no
`/var/log/syslog` or `/var/log/auth.log`. Filebeat reads the journal directly
(one `journald` input), which captures syslog, auth (sshd/sudo), kernel,
systemd, and every `pve*`/`corosync`/`pmxcfs` daemon from one place with no
rsyslog/file double-ingest.

## The mapping gotcha (important — do not "simplify" away)

`ecs@mappings` ships a dynamic template `ecs_date` that maps **any** field named
`*_timestamp` to type `date`. The journald input emits
`journald.custom.syslog_timestamp` containing the raw syslog text
(e.g. `"Jul 17 09:49:50 "`), which fails date parsing — and Elasticsearch then
**rejects the entire document**. The symptom is nasty: only native-journal
events (systemd) index, while every *syslog-transport* event (sshd, cron, pve
daemons) is silently dropped. Two guards, both kept:

1. `filebeat.proxmox.yml` drops `journald.custom.syslog_timestamp` (redundant
   with `@timestamp`). This is the effective fix.
2. The template sets `date_detection: false` and maps `journald.custom.*` to
   keyword (defense-in-depth; note it can't override `ecs_date` because
   composed-component dynamic templates are evaluated first).

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

The superuser password is used **only** in step 1 from your workstation; hosts
authenticate as `filebeat_proxmox` via their keystore and never store it.

## Viewing the logs

- **Kibana** (http://logs.fox:5601): add/pick the `filebeat-proxmox-*` data view;
  filter by `host.name`, `log.syslog.appname` (sshd, pvedaemon, pmxcfs, …),
  `tags: pve`, or `log.syslog.priority`.
- **PolySIEM**: covered by the existing `filebeat-*` read key. To surface it in the
  in-app log viewer, point (or add) an Elasticsearch integration index pattern at
  `filebeat-proxmox-*` in Settings → Integrations. (Left to the operator — this
  rollout did not modify PolySIEM integration settings.)

## Hardening follow-ups

- **TLS**: hosts use `ssl.verification_mode: none` (self-signed cluster cert).
  Pin the CA instead — ship the cert and set `ssl.certificate_authorities`.
- **/var/log/pve/tasks**: task *lifecycle* is already captured via journald
  (pvedaemon "starting/end task UPID…"). Raw per-task output files are not
  shipped (noisy, unstructured); add a `filestream` input if you want them.
