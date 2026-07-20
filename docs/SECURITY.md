# Security and threat intelligence

PolySIEM's security side is really a few pieces working together: posture checks, local log analysis, community threat intelligence, and investigation tooling. Each one is useful on its own, but wiring up all three data sources is what lets PolySIEM correlate your infrastructure, your logs, and outside indicators.

## Security advisor

The **Security score** page evaluates the state you've already documented in PolySIEM. It looks at:

- network exposure, including port forwards, public DNS, tunnels, and open wireless networks
- edge and Proxmox firewall hygiene
- users, API tokens, integration TLS, and credential hygiene
- host hardening, SSH-key coverage, service exposure, and guest isolation
- how complete and fresh your inventory documentation is

Every finding lists the affected entities and how to fix it. Dismissals are tracked without hiding the underlying check, so the score can be re-evaluated as your lab changes.

## AI providers

Open **Settings → AI assistant** and pick a provider:

- **Ollama** keeps prompts and responses on infrastructure you control.
- **OpenAI**, **DeepSeek**, **Anthropic**, and **Azure OpenAI** use their hosted APIs.

Turning the assistant on adds chat, guided documentation interviews, AI workflow actions, and ticket investigations. Hosted API keys are encrypted with `APP_SECRET` and are never returned to the browser after saving.

Whichever provider you select receives the context needed for the action you request. If that context must stay inside your network, use Ollama; choosing a hosted provider sends the relevant prompt and context to that provider.

## Threat watch

Threat watch reads aggregated log evidence from an Elasticsearch integration. It can go through Suricata alerts, Cloudflared activity, and general error patterns, then open deduplicated security tickets with severity, evidence, and suggested next steps.

To set it up:

1. Add a read-only Elasticsearch integration under **Settings → Integrations**.
2. Configure and enable an AI provider under **Settings → AI assistant**.
3. Open **Logs → Threats → Threat watch**, select **Configure**, and choose the log source, schedule, time window, and scopes.
4. Run a scan right away, or let the configured schedule handle it.

You can hand any ticket back to the assistant for a deeper investigation. Investigation reports keep their evidence trail and remediation checklist.

## AlienVault OTX

OTX supplies community threat reports and their indicators of compromise. PolySIEM caches the selected feed incrementally, shows its pulses, and compares public IPv4 indicators against recent Elasticsearch logs.

Admins can add a shared OTX integration under **Settings → Integrations**. Individual users can save a personal OTX key under **Settings → Profile** instead. See [integration setup](integration-setup.md#alienvault-otx) for the credential steps.

## Suricata rules export

PolySIEM can turn the current shared OTX feed into deterministic Suricata rules. Inbound and outbound IP alerts are generated in bounded groups, and domain indicators become DNS query alerts. Rules get stable local SIDs, so they don't change identity on every download. The endpoint requires a PolySIEM API token with the `read` scope.

To hook up OPNsense Suricata:

1. Configure a shared OTX integration and open **Logs → Threats → Threat intel**.
2. Select **Suricata export** and create a `read`-scoped token under **Settings → API tokens**.
3. Paste the token into the export dialog and copy its generated OPNsense registration command.
4. Run the command through your existing SSH access to OPNsense.
5. In OPNsense, open **Services → Intrusion Detection → Administration → Download**, enable **PolySIEM OTX threat intel**, and select **Download & Update Rules**.
6. Set up a daily rule-update schedule under the intrusion-detection settings.

One thing to watch for: OPNsense firmware upgrades can remove custom ruleset metadata. If the PolySIEM feed disappears from the Download tab, run the registration command again.

## Security boundaries

A few things worth knowing about where your data goes:

- Infrastructure synchronization is read-only and should use dedicated least-privilege tokens.
- Integration and hosted-AI credentials are encrypted at rest with `APP_SECRET`.
- OTX-to-log matching queries Elasticsearch without copying the complete log store into PolySIEM.
- The Suricata endpoint exposes generated threat rules only to an authenticated `read` token.
- Back up `.env` along with the database. If you lose `APP_SECRET`, you'll be re-entering every encrypted credential.

Return to the [documentation hub](README.md).
