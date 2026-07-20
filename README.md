<p align="center">
  <img src="public/brand/polysiem-readme.svg" width="760" alt="PolySIEM — Homelab intelligence, documented">
</p>

<p align="center">
  Self-hosted inventory, network context, security visibility, and runbooks—kept in sync with your homelab.
</p>

<p align="center">
  <a href="https://github.com/Realynx/PolySIEM/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Realynx/PolySIEM/ci.yml?branch=master&amp;label=CI" alt="CI status"></a>
  <a href="https://github.com/Realynx/PolySIEM/actions/workflows/release.yml"><img src="https://github.com/Realynx/PolySIEM/actions/workflows/release.yml/badge.svg" alt="Release status"></a>
  <a href="https://github.com/Realynx/PolySIEM/releases"><img src="https://img.shields.io/github/v/release/Realynx/PolySIEM" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://demo.polysiem.f0x.app/"><strong>Explore the live demo</strong></a>
</p>

## About PolySIEM

PolySIEM turns scattered homelab state into a living source of truth. It documents hosts, VMs, containers, services, networks, firewall policy, storage, and runbooks while preserving where each fact came from.

- Connect Proxmox, OPNsense, UniFi, Cloudflare, Tailscale, Elasticsearch, OTX, Censys, and SecurityTrails.
- Search and annotate inventory with audit history and cross-integration network context.
- Explore logs, investigate threats, build workflows, and expose scoped documentation through MCP.
- Run on your own infrastructure with encrypted credentials, roles, and no default accounts.

## Security, AI, and Suricata

- **Security advisor:** scores network exposure, firewall hygiene, access and identity, host hardening, and documentation coverage, then provides prioritized remediation guidance.
- **AI assistant:** supports local Ollama or hosted OpenAI, DeepSeek, Anthropic, and Azure OpenAI. Use it for chat, documentation interviews, workflows, and security investigations; provider credentials are encrypted at rest.
- **Threat watch:** uses the selected AI provider to review Elasticsearch log digests—including Suricata alerts, Cloudflared activity, and error spikes—and opens evidence-backed security tickets.
- **OTX and Suricata:** pulls AlienVault OTX community threat intelligence, checks its IP indicators against your logs, and serves a generated IP/DNS ruleset that OPNsense Suricata can subscribe to.

See [Security and threat intelligence](docs/SECURITY.md) for setup, privacy boundaries, and the Suricata workflow.

## Install

All installers generate secrets, start PostgreSQL and PolySIEM, and wait for the health check. When setup finishes, open `http://<your-server>:3000` and create the first administrator account.

### Linux — Docker (recommended)

For Debian, Ubuntu, Fedora, and RHEL-family hosts:

```bash
curl -fsSL https://github.com/Realynx/PolySIEM/releases/latest/download/install.sh | bash
```

### Windows — Docker Desktop

Install and start Docker Desktop using Linux containers, then run in PowerShell:

```powershell
irm https://github.com/Realynx/PolySIEM/releases/latest/download/install.ps1 | iex
```

The installation is stored under `%LOCALAPPDATA%\PolySIEM`.

### Linux VM or LXC — Native

For a Debian or Ubuntu VM/LXC without Docker:

```bash
curl -fsSL https://github.com/Realynx/PolySIEM/releases/latest/download/install-vm.sh | bash
```

This installs Node.js, PostgreSQL, and a checksum-verified prebuilt runtime with a hardened `polysiem.service` systemd unit. On architectures without a native bundle, it falls back to a source build.

Build from source instead of using the release bundle:

```bash
curl -fsSL https://github.com/Realynx/PolySIEM/releases/latest/download/install-vm.sh | bash -s -- --source
```

Force a repair/reinstall of the current release:

```bash
curl -fsSL https://github.com/Realynx/PolySIEM/releases/latest/download/install-vm.sh | bash -s -- --force
```

Uninstall PolySIEM, including its database, configuration, runtime, and backups:

```bash
curl -fsSL https://github.com/Realynx/PolySIEM/releases/latest/download/install-vm.sh | bash -s -- --uninstall
```

The uninstall leaves the shared Node.js and PostgreSQL OS packages installed.

### Manual Docker Compose or source build

```bash
mkdir -p /opt/polysiem && cd /opt/polysiem
curl -fL -o docker-compose.yml https://github.com/Realynx/PolySIEM/releases/latest/download/docker-compose.yml
# Create .env with DB_PASSWORD, DATABASE_URL, APP_SECRET, and APP_URL
docker compose up -d
```

Use the [installation guide](docs/INSTALL.md) for the complete `.env` example, source builds, upgrades, backups, migration, and troubleshooting.

## Documentation

<p align="center">
  <a href="docs/README.md"><strong>Docs hub</strong></a> ·
  <a href="docs/INSTALL.md">Installation</a> ·
  <a href="docs/CONFIGURATION.md">Configuration</a> ·
  <a href="docs/integration-setup.md">Integrations</a> ·
  <a href="docs/SECURITY.md">Security</a> ·
  <a href="docs/MCP.md">MCP</a> ·
  <a href="docs/DEVELOPMENT.md">Development</a>
</p>

<p align="center"><sub>Released under the <a href="LICENSE">MIT License</a>.</sub></p>
