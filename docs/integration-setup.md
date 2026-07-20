# PolySIEM — Integration setup & least-privilege credentials

Every integration in PolySIEM is read-only by design: syncs only *pull* state from your tools, never push. The credentials you hand it should match that. Make a dedicated user or token that can read what PolySIEM needs and nothing else. This guide walks through creating that credential for each integration type, and the **Add integration** dialog (**Admin → Integrations**) shows a condensed version of the same steps inline while you fill in the form.

> Credentials are encrypted with `APP_SECRET` before they touch the database and are never shown again after saving. Every integration has a **Test connection** button; use it before enabling sync.

## Contents

- [Proxmox VE](#proxmox-ve)
- [OPNsense](#opnsense)
- [Elasticsearch](#elasticsearch)
- [AlienVault OTX](#alienvault-otx)
- [UniFi](#unifi)
- [Cloudflare](#cloudflare)
- [AI providers](#ai-providers)
- [Demo mode](#demo-mode)

## Proxmox VE

Verified on Proxmox VE 8 and 9. On any cluster node shell:

```bash
pveum user add polysiem@pve --comment "PolySIEM read-only sync"
pveum acl modify / --users polysiem@pve --roles PVEAuditor
pveum user token add polysiem@pve sync --privsep 0
```

What this does:

1. Creates a dedicated `polysiem@pve` user. It never logs in interactively; it exists only to own the API token.
2. Grants **`PVEAuditor`** on path `/`, which is Proxmox's built-in read-only audit role. That's all PolySIEM needs. No write or admin privileges, ever.
3. Creates an API token named `sync`. `--privsep 0` turns off privilege separation, so the token simply inherits the user's (already read-only) permissions and there's no separate token ACL to maintain.

The last command prints the token **secret once**. Copy it before closing the shell.

In PolySIEM:

| Field | Value |
|---|---|
| Base URL | `https://<node>:8006` — any cluster node works |
| API token ID | `polysiem@pve!sync` |
| API token secret | the value printed by `pveum user token add` |

## OPNsense

Verified on OPNsense 26.1.

1. **System → Access → Users** → add a user `polysiem` with a long random password. PolySIEM never uses the password, only the API key.
2. Grant **only** these privileges:
   - **Lobby: Dashboard**
   - **Status: Interfaces**
   - **Firewall: Rules [new]**
   - **Firewall: Aliases**
   - …plus the settings page of whichever DHCP service you actually run:
     - **Services: Dnsmasq DNS/DHCP: Settings**, or
     - the ISC DHCPv4 settings page, or
     - the Kea DHCP settings page
3. Save, then in the user's **API keys** section click **+**. A `key`/`secret` pair downloads once as a text file.
4. In PolySIEM enter the firewall's web UI address as the Base URL (e.g. `https://192.168.1.1`), plus the key and secret.

> **No firmware privilege is needed.** PolySIEM reads the OPNsense version from the dashboard's `system_information` endpoint, so this key cannot query or trigger firmware updates.

For DHCP leases, PolySIEM queries the ISC DHCPv4, Dnsmasq and Kea lease APIs and uses whichever respond. That's why you only need to grant the settings privilege for the service(s) you actually use.

## Elasticsearch

Verified on Elasticsearch 8 and 9 with security enabled. Create a scoped read-only API key, either via Kibana **Dev Tools** or with `curl` as an admin user:

```
POST /_security/api_key
{
  "name": "polysiem",
  "role_descriptors": {
    "polysiem_read": {
      "cluster": ["monitor"],
      "indices": [{
        "names": ["logs-*", "filebeat-*"],
        "privileges": ["read", "view_index_metadata", "monitor"]
      }]
    }
  }
}
```

Use the **`encoded`** field of the response as the API key in PolySIEM.

Two details to get right. The index `names` you grant must cover the **index pattern** configured on the integration; comma-separated patterns are supported (e.g. `logs-*,filebeat-*`), so make sure each pattern you query is covered by the key. And the cluster **`monitor`** privilege is required by the **Test connection** button, which hits `/`, `_cluster/health` and `_cat/indices`.

Username/password auth also works if you'd rather use a dedicated user with an equivalent read-only role, but an API key is easier to scope, rotate and revoke.

## AlienVault OTX

AlienVault OTX is a free community threat-intelligence feed. Create an account at [otx.alienvault.com](https://otx.alienvault.com), then open [your OTX API page](https://otx.alienvault.com/api) and copy the **OTX Key**.

Admins can add a shared instance integration using `https://otx.alienvault.com` as the base URL. Individual users can save their own key under **Settings → Profile → Threat intelligence** instead. If you want a bigger feed, subscribe to additional pulses or authors in OTX and PolySIEM will pick them up.

PolySIEM caches pulses incrementally, cross-checks their public IP indicators against Elasticsearch logs, and can turn a shared instance feed into an authenticated Suricata ruleset. See [Security and threat intelligence](SECURITY.md#alienvault-otx).

## UniFi

The preferred integration uses UniFi's local Network API. The same API is exposed by self-hosted UniFi OS Server and UniFi console/gateway hardware, so no deployment-specific driver is required. You do **not** need a UniFi gateway: an AP-only self-hosted site is valid, and PolySIEM discovers its adopted APs, WLANs, clients, and controller-defined networks. If the newer site catalog is empty, PolySIEM probes the configured local site (normally `default`) with the same API key instead of treating the missing gateway as an error.

1. In UniFi Network, open **Settings → Control Plane → Integrations**.
2. Create an API key named `PolySIEM` and copy it when shown.
3. In PolySIEM, enter the local host address (for example `https://10.0.3.14:11443`) and the API key. Do not append the `/unifi-api/network` documentation path.
4. Leave **Site** as `default` for a single-site installation. For multiple sites, enter the site's display name, internal reference, or UUID.
5. Disable **Verify TLS certificate** only when the local host uses a self-signed certificate you have independently verified.

PolySIEM sends the key only in the `X-API-KEY` header and performs GET requests. A sync records source-owned evidence for UniFi networks/VLANs, connected clients, adopted gateways and switches, APs, and WiFi broadcasts. Connected clients are observations, conservatively reconciled with Proxmox and other inventory by MAC/IP, so they never overwrite another integration's asset data.

Running a Network Server version without the official API? Use **Legacy local account** in the form instead. Create a dedicated local **View Only** admin and use the classic controller address, commonly `https://<host>:8443`.

## Cloudflare

Cloudflare ships a premade read-only policy, so there's no need to assemble individual permissions yourself:

1. Open **My Profile → API Tokens → Create Token**.
2. Find **Read All Resources** and choose **Use template**.
3. Keep its read-only policies, then scope the account and zone resources to the Cloudflare account you want PolySIEM to document.
4. Create and copy the token, then copy the account's 32-character **Account ID** from its overview page.

Add one PolySIEM integration per Cloudflare account. That keeps tunnels, DNS, private routes, and published hostnames attributed to the correct account. The template includes all Account, Zone, and User read permissions but no write permissions, and PolySIEM only issues GET requests anyway.

**Test connection** probes the selected account's zone and tunnel resources, the same permissions used by sync. It deliberately avoids Cloudflare's token-verification endpoint: Cloudflare exposes separate verification routes for user-owned and account-owned tokens, which can produce a misleading 401 when the ownership route does not match the otherwise valid token.

## AI providers

Configure AI under **Settings → AI assistant**. PolySIEM supports local **Ollama** and hosted **OpenAI**, **DeepSeek**, **Anthropic**, and **Azure OpenAI** providers.

For Ollama, enter the endpoint (for example `http://ollama.lan:11434`) and select a model. No API credential is required; keep the Ollama port LAN-only.

For a hosted provider, enter its API key and model or Azure deployment. Keys are encrypted with `APP_SECRET` before storage and are never returned to the browser. Bear in mind that hosted providers receive the prompt and relevant PolySIEM context for requested AI actions; if that data must stay inside your network, run Ollama.

See [Security and threat intelligence](SECURITY.md#ai-providers) for the features enabled by the selected provider.

## Demo mode

Want to explore PolySIEM without touching real infrastructure? In **Settings → Integrations**, enable **Developer mode**, then enable **Mock integrations**. Mock sources don't need credentials. Choose a scenario and stable seed when adding Proxmox, OPNsense, UniFi, Elasticsearch, or AlienVault OTX; matching profile/seed pairs share one coherent generated lab.

The available scenarios cover the anonymized proportions of the current lab, a small test lab, a healthy demo, a partial outage, and an active security incident. Reusing a seed reproduces the same identities and relationships, while generated timestamps remain live-looking unless a test pins the scenario clock. Existing `mock://demo` integrations continue to select the legacy healthy scenario.

For a mutable development demo, set `POLYSIEM_DEMO_MODE=true`. This forces the effective mock-integration feature on without enabling other future developer features. The server still requires an admin session to create or change integrations.

For a hosted public demo, use the dedicated locked stack instead:

```bash
docker compose -f deploy/docker-compose.demo.yml up -d --wait
```

It creates a separate demo database, provisions the coordinated mock providers, enables mock AI, and exposes the pre-filled `demo` / `polysiem-demo` login. The server rejects persistent mutations with HTTP 423 and disables background writers. Its bootstrap marker and empty-database check prevent the command from converting an existing PolySIEM installation.

The dedicated demo Compose stack checks the verified GHCR `latest` image every five minutes and recreates only the demo application when a newer release is published. The Docker socket is mounted only into the isolated updater container; the PolySIEM container never receives Docker control.

> Note: the development seed (`npm run db:seed`) creates no accounts or default credentials. The first-run installer asks for the administrator, optionally connects live integrations, and presents a skippable mock dashboard tutorial. Install persistent mock sources from the Integrations page so the scenario and seed are explicit.
