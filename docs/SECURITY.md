# Security and threat intelligence

PolySIEM combines posture checks, local log analysis, community threat intelligence, and investigation tooling. Each feature remains useful on its own; connecting all three data sources lets PolySIEM correlate infrastructure, logs, and outside indicators.

## Security advisor

The **Security score** page evaluates the state already documented in PolySIEM. Its findings cover:

- Network exposure, including port forwards, public DNS, tunnels, and open wireless networks.
- Edge and Proxmox firewall hygiene.
- User, API-token, integration TLS, and credential hygiene.
- Host hardening, SSH-key coverage, service exposure, and guest isolation.
- Inventory documentation coverage and freshness.

Each finding includes affected entities and remediation guidance. Dismissals are tracked without hiding the underlying check, so the score can be re-evaluated as the lab changes.

## AI providers

Open **Settings → AI assistant** to choose a provider:

- **Ollama** keeps prompts and responses on infrastructure you control.
- **OpenAI**, **DeepSeek**, **Anthropic**, and **Azure OpenAI** use their hosted APIs.

Enabling the assistant adds chat, guided documentation interviews, AI workflow actions, and ticket investigations. Hosted API keys are encrypted with `APP_SECRET` and are never returned to the browser after saving.

The selected provider receives the context needed for the action you request. Use Ollama when that context must remain inside your network; choosing a hosted provider sends the relevant prompt and context to that provider.

## Threat watch

Threat watch reads aggregated log evidence from an Elasticsearch integration. It can review Suricata alerts, Cloudflared activity, and general error patterns, then create deduplicated security tickets with severity, evidence, and suggested next steps.

To enable it:

1. Add a read-only Elasticsearch integration under **Settings → Integrations**.
2. Configure and enable an AI provider under **Settings → AI assistant**.
3. Open **Logs → Threats → Threat watch**, select **Configure**, and choose the log source, schedule, time window, and scopes.
4. Run a scan immediately or allow the configured schedule to run it.

Tickets can be investigated further by the assistant. Investigation reports retain their evidence trail and remediation checklist.

## AlienVault OTX

OTX supplies community threat reports and their indicators of compromise. PolySIEM incrementally caches the selected feed, displays its pulses, and compares public IPv4 indicators with recent Elasticsearch logs.

Admins can add a shared OTX integration under **Settings → Integrations**. Individual users can instead save a personal OTX key under **Settings → Profile**. See [integration setup](integration-setup.md#alienvault-otx) for credential steps.

## Suricata rules export

PolySIEM converts the current shared OTX feed into deterministic Suricata rules:

- Inbound and outbound IP alerts are generated in bounded groups.
- Domain indicators become DNS query alerts.
- Stable local SIDs prevent rules from changing identity on every download.
- The endpoint requires a PolySIEM API token with the `read` scope.

To connect OPNsense Suricata:

1. Configure a shared OTX integration and open **Logs → Threats → Threat intel**.
2. Select **Suricata export** and create a `read`-scoped token under **Settings → API tokens**.
3. Paste the token into the export dialog and copy its generated OPNsense registration command.
4. Run the command through your existing SSH access to OPNsense.
5. In OPNsense, open **Services → Intrusion Detection → Administration → Download**, enable **PolySIEM OTX threat intel**, and select **Download & Update Rules**.
6. Configure a daily rule-update schedule under the intrusion-detection settings.

OPNsense firmware upgrades can remove custom ruleset metadata. If the PolySIEM feed disappears from the Download tab, run the registration command again.

## Security boundaries

- Infrastructure synchronization is read-only and should use dedicated least-privilege tokens.
- Integration and hosted-AI credentials are encrypted at rest with `APP_SECRET`.
- OTX-to-log matching queries Elasticsearch without copying the complete log store into PolySIEM.
- The Suricata endpoint exposes generated threat rules only to an authenticated `read` token.
- Back up `.env` with the database; losing `APP_SECRET` means re-entering encrypted credentials.

Return to the [documentation hub](README.md).
