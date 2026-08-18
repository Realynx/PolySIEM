# PolySIEM API & internal contracts

Every route handler returns `{ data: ... }` on success or `{ error: { code, message, details? } }` on failure. Wrap the handler body in `handleApi()` from `src/lib/api.ts` and throw `ApiError(status, code, message)` when something goes wrong. Validate bodies and query strings with the zod schemas in `src/lib/validators/`.

For auth, API routes use `requireUser()` / `requireAdmin()` from `src/lib/auth/guards.ts`, which throw a 401/403 `ApiError`. Pages use `requirePageUser()` / `requirePageAdmin()` instead, which redirect.

One rule worth repeating: all mutations go through the `src/lib/services/*` functions, because that is where `AuditLog` rows get written. Never call Prisma mutations for inventory, docs, or users directly from a route handler.

## Route table

| Method | Path | Auth | Owner |
|---|---|---|---|
| GET/POST | /api/setup | public (only while setup incomplete) | done (Phase 0) |
| POST | /api/auth/login, /api/auth/logout | public / session | done (Phase 0) |
| GET/PATCH | /api/me | session | done (Phase 0) |
| GET | /api/health | public | done (Phase 0) |
| GET | /api/search?q=&kinds= | session | done (Phase 0) |
| GET/POST | /api/inventory/hosts, vms, containers, services, networks, ips, storage | session | A |
| GET/PATCH/DELETE | /api/inventory/{entity}/[id] | session | A |
| PATCH | /api/firewall/rules/[id] (annotation only) | session | B |
| GET/POST | /api/docs; GET/PATCH/DELETE /api/docs/[id] | session | A |
| GET | /api/docs/linked?kind=&id= | session | Documentation backlinks for an inventory item |
| GET/POST/DELETE | /api/tags; POST/DELETE /api/tags/assign | session | A |
| GET | /api/audit?entityType=&entityId= | session | C |
| GET/POST | /api/admin/users; PATCH/DELETE /api/admin/users/[id] | admin | C |
| GET/PATCH | /api/admin/settings | admin | C |
| GET | /api/admin/updates; GET/POST /api/admin/updates/request | admin | C |
| GET, POST | /api/internal/auto-update | local update agent bearer token | C |
| GET/POST/DELETE | /api/admin/api-tokens(/[id]) | admin | C |
| GET/POST | /api/admin/ai-credentials; PATCH/DELETE /api/admin/ai-credentials/[id] (AI credential store; secrets are write-only — REST never returns a decrypted secret) | admin | done |
| GET/POST | /api/admin/backup/export (GET: full gzipped-JSON logical dump with ciphertext tied to this APP_SECRET; POST `{ password }`: portable AES-256-GCM encrypted `.psbackup` containing re-keyable credentials) | admin | done |
| POST | /api/admin/backup/import?preview=1 (multipart `file` + optional `password`; RestoreSummary, no writes) / apply with header x-confirm-restore:true (DESTRUCTIVE transactional wipe-and-replace; protected credentials are re-encrypted for this instance) | admin | done |
| GET | /api/admin/backup (BackupStateDto: config + destinations + history); PUT /api/admin/backup/config | admin | done |
| GET/POST | /api/admin/backup/destinations; GET/PATCH/DELETE /api/admin/backup/destinations/[id] (S3/Azure targets; secrets encrypted, never returned) | admin | done |
| POST | /api/admin/backup/destinations/[id]/test; POST .../[id]/upload (run a backup → push to the destination) | admin | done |
| GET/POST | /api/admin/integrations; PATCH/DELETE /api/admin/integrations/[id] | admin | B |
| POST | /api/admin/integrations/[id]/test | admin | B |
| POST | /api/integrations/[id]/sync | admin | B |
| GET | /api/integrations/status | session | B |
| GET | /api/integrations/[id]/runs | session | B |
| GET/POST | /api/network/edge-networks/servers/[id]/host-key (scan/pin SSH host identity) | admin | B |
| POST | /api/network/edge-networks/servers/[id]/provision (pin identity, install restricted helper through transient admin authorization, then verify) | admin | B |
| GET/PUT | /api/network/edge-networks/servers/[id]/wireguard (GET session → `{settings, peerConfig}`; PUT admin configures/rotates the edge tunnel via `configureWireguardSchema`, marks pendingChanges — private key generated server-side, stored only in encrypted credentials, never returned) | session / admin | C |
| GET/POST | /api/network/connectors (GET: `ConnectorDto[]`, optional `?integrationId=`; POST `createConnectorRequestSchema` → 201 `{connector, installToken, installCommand, installCommandInsecure, installUrl}` — the plaintext token exists ONLY in this response) | session / admin | B |
| GET/PATCH/DELETE | /api/network/connectors/[id] (PATCH `updateConnectorSchema`: name/notes/disabled; DELETE cascades the connector's routes and marks the edge pending) | session / admin / admin | B |
| POST | /api/network/connectors/[id]/rotate-token (mints a fresh one-time install token + command, invalidating the previous one) | admin | B |
| POST | /api/network/connectors/enroll (MACHINE, `connectorEnrollSchema`; agent posts its own WG public key, server rotates the token and returns `{connectorId, agentToken, tunnelAddress, tunnelCidr, interfaceName, edge{endpoint,publicKey,allowedIps,persistentKeepalive}, pollIntervalSeconds}`; 401 invalid_token / 403 connector_disabled / 409 already_enrolled; 30/min per IP) | public (pscx_ token) | B |
| POST | /api/network/connectors/config (MACHINE, `connectorHeartbeatSchema`; heartbeat in, `{configHash, interfaceName, tunnelAddress, edge, routes[], pollIntervalSeconds}` out — `routes[].listenPort` is the PUBLIC port; 401 invalid_token / 404 unknown_connector / 403 connector_disabled; 30/min per IP) | public (pscx_ token) | B |
| GET | /api/network/connectors/install.sh?token=&insecure=1 (MACHINE, `text/x-shellscript`; always 200 — an unknown/consumed token returns a script that prints a generic error and exits 1, so existence never leaks; 30/min per IP) | public (pscx_ token) | B |
| GET/POST | /api/keys (POST: create from pasted authorized_keys text) | session | H |
| POST | /api/keys/generate (returns the private key ONCE; only the public half is stored) | session | H |
| GET/PATCH/DELETE | /api/keys/[id] (PATCH: name/ownerLabel/purpose) | session | H |
| POST | /api/keys/[id]/deployments; DELETE /api/keys/[id]/deployments/[deploymentId] | session | H |
| POST | /api/keys/[id]/proxmox-install (append to a PVE VM's cloud-init sshkeys) | session | H |
| GET/POST | /api/tunnels (documented ingress tunnels; identifiers only, never run tokens) | session / admin | I |
| PATCH/DELETE | /api/tunnels/[id] | admin | I |
| GET | /api/tunnels/traffic?window=24h (live cloudflared event counts per tunnel/hostname; `mode: hostname\|tunnel\|unavailable`, never fails hard) | session | I |
| POST | /api/tunnels/refresh-dns (resolve ingress + dyndns hostnames to edge IPs; flags WAN exposure) | admin | I |
| GET | /api/bandwidth?window=1h\|6h\|24h (delta-polled firewall bandwidth: per-rule totals/rates joining FirewallRule.externalId + per-interface in/out joining Network.externalId; rates are bits/sec; `status.skipped` lists missing OPNsense privileges; empty when polling is off, never fails hard) | session | J |
| GET | /api/logs (live Elasticsearch query) | session | G |
| GET | /api/logs/stats (aggregations: by level, over time) | session | G |
| GET | /api/logs/insights?hours=1\|6\|24\|168 (Network insights dashboard: 12 live ES panel queries in parallel — Kibana "Network Insights" clone; per-panel errors degrade gracefully; panel index targets AUTO-DETECTED via field_caps marker fields + _resolve/index data-stream collapse, 30-min cache, static patterns as fallback — see elasticsearch/detect.ts) | session | G |
| GET | /api/logs/threat-intel?page=&limit= (latest OTX pulses, live w/ 5-min server cache) | session | G |
| GET | /api/logs/threat-intel/matches?hours=24 (feed IPv4 IOCs cross-matched against ES logs; `logSource: null` when no ES integration) | session | G |
| GET | /api/logs/threat-intel/suricata.rules (text/plain Suricata ruleset from feed IOCs; deterministic SIDs; counts in X-PolySIEM-Rules header; instance integrations only — "personal" falls through) | session OR ps_ token w/ read scope via Bearer or ?token= | G |
| PUT/DELETE | /api/me/otx-key (personal OTX key: probed live before save, stored encrypted on User.encryptedOtxKey; powers only that user's feed as source id "personal") | session | G |
| POST | /api/ai/generate (streaming text) | session | E |
| GET | /api/ai/models | session | E |
| POST | /api/workflows/hooks/[token] (inbound webhook trigger: fires the enabled workflow owning the whk_ token; JSON body = run input validated against trigger params; 30/min rate limit per token; returns only {runId, status}) | public (unguessable token) | done |
| ALL | /api/mcp (Streamable HTTP, Bearer ps_ token) | ApiToken | D |

## Key shared modules (frozen contracts)

Treat everything below as a frozen contract. Plenty of code depends on these exports, so change them deliberately, not in passing.

- `src/lib/db.ts` — Prisma singleton (`prisma`)
- `src/lib/api.ts` — `ApiError`, `jsonOk`, `jsonError`, `handleApi`
- `src/lib/crypto.ts` — `encryptSecret`, `decryptSecret`, `sha256Hex`, `randomToken`
- `src/lib/auth/session.ts` — `getSession`, `createSession`, `SESSION_COOKIE`, cookie options
- `src/lib/auth/guards.ts` — `requireUser`, `requireAdmin`, `requirePageUser`, `requirePageAdmin`
- `src/lib/auth/api-token.ts` — `createApiToken`, `requireApiToken`, `requireScope`, `TOKEN_SCOPES`
- `src/lib/settings.ts` — `getSetting`/`setSetting`, `SETTING_KEYS`, `getOllamaConfig`
- `src/lib/audit.ts` — `audit(actor, action, entity?, detail?)`
- `src/lib/types.ts` — `EntityKind`, `SearchResult`, `THEME_COLORS`, status value types
- `src/lib/format.ts` — `formatBytes`, `formatRelative`, `formatDateTime`
- `src/lib/services/inventory.ts` — full CRUD + firewall/dhcp reads; enforces integration-owned field guard
- `src/lib/services/docs.ts`, `tags.ts`, `search.ts`, `users.ts`
- `src/lib/ssh/keys.ts` — public-key parsing/fingerprints, ed25519 generation, install scripts (never stores private keys)
- `src/lib/topology/footprint.ts` — pure footprint-graph derivation (`deriveFootprint(FootprintInput)`); `footprint-data.ts` — server loader
- OPNsense sync footprint families: `PortForward`, `DyndnsHost`, `NetworkGateway` (privilege-gated: a 403 records a skip in SyncRun stats + shields the family from the stale sweep, run stays SUCCESS). `Tunnel` is MANUAL documentation, never synced.
- Edge NAT WireGuard tunnel (frozen contract): the edge is the LISTENER, the home OPNsense box INITIATES (CGNAT). Tunnel state lives in `IntegrationConfig.settings.wireguard` (`wireguardTunnelSchema`); the edge private key lives ONLY in `encryptedCredentials.wireguardPrivateKey` (never in settings/DTOs/logs/audit). `configureEdgeWireguard` generates/rotates the key + stores the derived public key + marks pendingChanges; `getEdgeWireguardPeerConfig`/`getEdgeWireguardConfig` derive the paste-ready OPNsense values (`deriveEdgeWireguardPeerConfig` in `edge-network-state.ts`: edge public key, `host:listenPort` endpoint, edge address, recommended OPNsense `.2` address, edge `/32` AllowedIPs). When enabled, `applyEdgeNatRules` folds the WG block into the same revision/`desiredRulesHash`/atomic-apply as the NAT rules and points the NAT outbound at the WG interface; when disabled it is byte-identical to the pre-WireGuard apply. `client.ts` `parseEdgeNatWireguardStatus`/`fetchEdgeNatStatusReport` surface a separate `EdgeWireguardStatus` (WG_IF/WG_ENABLED/WG_PUBKEY/WG_LISTEN/WG_PEERS/WG_LATEST_HANDSHAKE) alongside the (orchestrator-owned) NAT snapshot — no private material.
- Connectors (frozen contract) — Cloudflare-Tunnel-style reverse tunnel for hosts with no public IP. A `Connector` row belongs to one Edge NAT Server; PolySIEM is the control plane and the connector **pulls** its config (nothing inbound to the connector). Lifecycle: create (admin) → allocate `connectorId` + an **implicit** `tunnelAddress` + a one-time `pscx_` install token → operator pastes the one-liner → the agent generates its OWN WireGuard keypair locally and enrolls → poll. **Token model:** `Connector.installTokenHash` is the sha256 of whichever token is currently valid; enrollment rotates it to a fresh agent token, so the install token is single-use. Plaintext is returned only by create / rotate-token / enroll, never stored, logged, or audited; comparison is `timingSafeEqual`. `installTokenHash` must never appear in a DTO — `toConnectorDto` is an explicit allow-list projection, not a spread.
  - `src/lib/connectors/allocate.ts` (pure, ES2017 number math — no BigInt): `tunnelSubnetFrom(edgeAddressCidr)` → `{cidr, edgeHost, prefix}`; `allocateTunnelAddress(cidr, edgeHost, taken[])` → next free host, skipping the network/broadcast addresses, the edge host, and the manual peer's AllowedIPs; throws `TunnelAllocationError` (`invalid_subnet` | `exhausted`).
  - `src/lib/services/connectors.ts`: `listConnectors`, `getConnector`, `createConnector`, `updateConnector`, `deleteConnector`, `rotateConnectorToken` (operator, audited) plus `enrollConnector` / `connectorConfig` / `connectorInstallContext` (machine). Status is DERIVED, not trusted: `disabled` → `pending` (unenrolled) → `connected` while the last heartbeat/handshake is inside 3 poll intervals (`CONNECTOR_POLL_INTERVAL_SECONDS` = 30) → `stale`. Allocation runs under the SAME `pg_advisory_xact_lock('polysiem-edge-rules-' || integrationId)` as edge rule edits.
  - **Route modes (§1b):** `EdgeNatRule.mode` is `"direct"` (default — the edge DNATs straight to `targetAddress:targetPort`; NEVER regress it) or `"connector"` (the edge DNATs to `connector.tunnelAddress` on the SAME public port, and the connector performs the last hop to `targetAddress:targetPort` as seen FROM THE CONNECTOR). With no connectors present the emitted edge ruleset is byte-identical to the pre-connector output. Connector-mode rules whose connector is missing/disabled/unenrolled are dropped from the apply; creating one is rejected with `ApiError(400, "connector_not_enrolled")`.
  - **Edge WireGuard peers (§1c) are derived, not stored:** `peers = [optional settings.wireguard.peer] ++ [every enrolled, non-disabled connector → {publicKey, allowedIps: ["<tunnelAddress>/32"], endpoint: null, persistentKeepalive: 25}]`. Peer churn calls the exported `markEdgeRulesPending(tx, integrationId)` from inside the same lock, so the existing Apply button pushes it.
  - `src/lib/integrations/connector/` (agent + installer) owns `canonicalConnectorRuleset(routes)` / `connectorRulesetHash(routes)`; the service publishes that hash as `configHash` so the agent can compare it against what it has applied.
- `TunnelHostname` model: one row per tunnel ingress hostname, reconciled from `Tunnel.ingressHostnames` on create/patch (the array stays the write path). Carries `resolvedIps`, `proxied`, `lastResolvedAt`, `metadata.classification`.
- `src/lib/dns/cloudflare.ts` — pure edge-range classification: `isCloudflareIp`, `classifyResolution(ips, wanIp)` → `proxied` | `unproxied-wan-exposed` | `unproxied-other` | `unresolved` (byte-array CIDR match, v4+v6). Ranges hardcoded from cloudflare.com/ips-* (2026-07-17).
- `src/lib/services/tunnel-dns.ts` — `refreshTunnelDns()` (resolve+persist, audited via the route), `refreshTunnelDnsIfStale()` (6h self-throttle; hooked into the sync scheduler + dashboard loader, fire-and-forget), `reconcileTunnelHostnames`.
- `src/lib/integrations/elasticsearch/tunnel-traffic.ts` — pure `buildTrafficResult` + live `fetchTunnelTraffic` + `mockTunnelTraffic`; ES settings gained `cloudflaredIndexPattern` (default `cloudflared-*`), `tunnelHostnameField` (default `url.domain`), `tunnelHostField` (default `host.name`). `src/lib/services/tunnel-traffic.ts` wraps it with a 60s cache and never throws.
- `src/lib/format.ts` also exports `formatCount` (1_240 → "1.2k").
- `src/lib/integrations/opnsense/bandwidth.ts` — pure `parsePfStatisticsRules` (pf per-rule byte counters; uuid labels join `FirewallRule.externalId`, unlabeled lines aggregate as `"system"`) + `parseTrafficInterface` (per-interface cumulative in/out; keys join `Network.externalId`) + `fetchBandwidthCounters` (403 → skip with the missing privilege: "Diagnostics: Firewall statistics" / "Reporting: Traffic") + deterministic `mockBandwidthCounters`.
- `src/lib/bandwidth/aggregate.ts` — pure aggregation for /api/bandwidth: `chooseBucketMs`, `aggregateRules`, `aggregateInterfaces`. Rates = bits/sec averaged over observed seconds; empty buckets are `null`, not 0; negative counter deltas (filter reload / reboot) start a new baseline. Provider-wide inbound/outbound summaries use only the internet-facing interface keys reported in `summaryInterfaceKeys`, avoiding LAN/WAN double-counting and mixed interface direction.
- `src/lib/services/bandwidth.ts` — `runBandwidthPollIfDue` (scheduler hook, self-throttled per `IntegrationConfig.settings.bandwidthPolling`/`bandwidthPollMinutes`, its own loop — never affects sync-run semantics), `pollIntegration` (delta computation + 7-day raw-sample pruning into `TrafficCounterSample`), `bandwidthReport`.
- OPNsense settings (`opnsenseSettingsSchema`): `bandwidthPolling` (default false — the user-facing toggle) + `bandwidthPollMinutes` (default 2). NOTE: `updateIntegrationSchema.settings` is a loose record on purpose; the service validates against the type-specific schema (a zod union would let the all-defaults ES schema swallow other types' settings).
- `src/lib/integrations/otx/` — AlienVault OTX driver (`IntegrationType.OTX`, live-query like Elasticsearch — excluded from the sync scheduler/engine via `isLiveQueryType`). `client.ts` (`X-OTX-API-KEY` auth; `/api/v1/users/me` test, `/api/v1/pulses/subscribed|activity` feed; 45s timeout — OTX takes 10-20s/page), pure `normalize.ts` (`toPulseView`, `extractIpIocs`/`extractDomainIocs` — public-IPv4/LDH-domain filters, per-pulse provenance, caps; `toUtcIso` stamps OTX's naive-UTC datetimes with Z). Settings: `{ feed: "activity" (default) | "subscribed" }` — the subscribed feed inlines FULL indicator lists and 504s/exceeds 10 MB per pulse for accounts following AlienVault; activity omits the reputation mega-pulses and caps pages at 20 pulses. Per-user keys: `resolveOtxSource(integrationId?, userId?)` — source id "personal" (PERSONAL_OTX_SOURCE_ID) resolves the caller's `User.encryptedOtxKey` into a synthetic DriverConfig (cache-keyed per user); personal wins by default when saved.
- `src/lib/services/threat-intel.ts` — `resolveOtxSource`/`listOtxSources`, `getPulseFeed`, `getIocMatches` (ES `terms` over ECS + raw eve IP fields), `getSuricataRuleset`, `purgePulseCache`. ALL reads come from the `OtxPulseCache` table (incremental cache keyed per source: integration id or `personal:<uid>`): first contact backfills up to 3×50 pulses, then a throttled (5-min TTL, per-process, in-flight-deduped) refresh sends `modified_since = maxModified − 10min` delta fetches — the same pulse is never re-downloaded. Rows store `{view, ips, domains}` with IOCs precomputed at ingest; cap 500 pulses/source (pruned by modified); refresh failure with a warm cache degrades to stale data. Cache purged on integration delete + personal-key removal.
- `src/lib/integrations/otx/suricata-rules.ts` — pure `generateSuricataRules`: per-pulse inbound+outbound `alert ip` rules (64-IP chunks) + per-domain `alert dns` (dns.query/endswith); SIDs deterministic via FNV-1a into the 1500000-1899999 local range (stable across re-downloads); `sanitizeMsg` strips msg-breaking chars. OPNsense subscribes via a metadata XML in /usr/local/opnsense/scripts/suricata/metadata/rules/ (snippet generated in the UI's "Suricata export" dialog).
- `src/lib/services/ai-credentials.ts` — AI credential store: secrets AES-GCM-encrypted at rest; REST/list responses are sanitized (`hasSecret`/`secretLength`, never the value). Decrypted secrets are ONLY exposed through the MCP tools `list_ai_credentials` (metadata) / `get_ai_credential` (secret), which require a `ps_` token with the `credentials` scope; every secret read is audited as `ai_credential.read` with the token/user id and credential name.
- `src/lib/validators/*` — zod v4 schemas (note: zod 4 — use `z.ipv4()`, `z.url()`, `z.enum([...])`)
- `src/components/shared/*` — `PageHeader`, `EmptyState`, `SourceBadge`, `StatusBadge`, `PowerBadge`, `SyncStatusBadge`
- `src/components/shell/nav.ts` — canonical route list for the sidebar
- `src/lib/backup/**` — full-instance backup: `export.ts` (logical dump of all 43 models via `BACKUP_MODELS`, BigInt/Date-safe through `toJsonSafe`, `appSecretFingerprint` in the manifest), `archive-crypto.ts` (portable password-protected scrypt + AES-256-GCM envelope), `portable-secrets.ts` (re-keys stored credential envelopes for the destination APP_SECRET), `import.ts` (transactional TRUNCATE-CASCADE + two-pass insert for forward FKs: docPage.parentId/ipAddress.interfaceId/switchVlan.networkId/securityTicket.scanRunId), `destinations/` (S3 SigV4 + Azure SAS/SharedKey, pure Node crypto — no cloud SDK), `service.ts` (destinations/config/history in AppSettings, secrets encrypted), `scheduler.ts` (startBackupScheduler in instrumentation). Unprotected restores need the same APP_SECRET; password-protected `.psbackup` files carry the source key inside the authenticated encrypted envelope and re-key credentials automatically.
- `src/lib/security/**` — security advisor: 250-point deduction pool (SCORE_CEILING), 5 categories with per-category ceilings, `SecurityFinding.weight` override; `checks/` are pure per-category modules run by `checks/index.ts`; SSH key coverage (hardening) = the keys-vs-passwords signal.
- Brand mark: `src/components/shell/app-logo.tsx` (AppLogo, pure SVG, currentColor); raster in `src/app/icon.svg` + `icon.png` + `public/icons/*` — regenerate from the same glyph.
- PWA: `src/app/manifest.ts` (standalone, theme #2563eb, icons in public/icons/ incl. maskable + apple-touch), `public/sw.js` (network-first navigations w/ `public/offline.html` fallback, cache-first only for /_next/static + /icons, never touches /api), registered prod-only by `src/components/pwa/service-worker-registration.tsx` in the root layout. Bump `VERSION` in sw.js when changing cached assets or SW behavior. Icons are rasterized from `public/brand/polysiem-mark.svg` and `polysiem-maskable.svg`.

## Conventions

- Server Components by default. Reach for a client component only when you actually need interactivity.
- Every list page gets a `loading.tsx` skeleton, an `EmptyState` with a CTA, and filter/search where it earns its keep.
- Client-side mutations go through `fetch` + TanStack Query `useMutation`, with a `sonner` toast on success or error.
- BigInt fields (memoryBytes etc.) don't survive JSON serialization, so map them to strings in responses (`JSON.parse(JSON.stringify(x, (k,v)=>typeof v==="bigint"?v.toString():v))` or map explicitly).
- On synced entities (source ≠ MANUAL), only `description`, `location`, `purpose`, and `annotation` are editable. Everything else belongs to the integration.
- Theme is a `data-theme` attr on `<html>` plus `next-themes` class dark mode. Never hardcode colors; use tokens.
