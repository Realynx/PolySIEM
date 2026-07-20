<p align="center">
  <img src="public/brand/polysiem-mark.svg" width="96" height="96" alt="PolySIEM logo">
</p>

<h1 align="center">PolySIEM</h1>

<p align="center">
  <strong>Your self-hosted homelab documentation and security dashboard.</strong>
</p>

<p align="center">
  Keep inventory, network context, firewall documentation, logs, and runbooks together—and in sync with the tools you already run.
</p>

<p align="center">
  <a href="https://github.com/Realynx/PolySIEM/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Realynx/PolySIEM/ci.yml?branch=master&amp;label=CI" alt="CI status"></a>
  <a href="https://github.com/Realynx/PolySIEM/actions/workflows/release.yml"><img src="https://github.com/Realynx/PolySIEM/actions/workflows/release.yml/badge.svg" alt="Release status"></a>
  <a href="https://github.com/Realynx/PolySIEM/releases"><img src="https://img.shields.io/github/v/release/Realynx/PolySIEM" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

## What it does

- Documents hosts, VMs, containers, services, networks, IPs, storage, and runbooks.
- Syncs inventory and security context from Proxmox, OPNsense, UniFi, Cloudflare, Elasticsearch, and OTX.
- Adds local AI assistance through Ollama and exposes documentation to MCP clients.
- Keeps credentials encrypted, changes audited, and access protected by roles.
- Runs on your own infrastructure with Docker or a native Linux installation.

## Quick start

On a fresh Debian, Ubuntu, Fedora, or RHEL-family system:

```bash
curl -fsSL https://github.com/Realynx/PolySIEM/releases/latest/download/install.sh | bash
```

Then open `http://<your-server>:3000` and create the first administrator account.

Windows Docker Desktop, manual Compose, source builds, native VM installs, upgrades, backups, and troubleshooting are covered in the [installation guide](docs/INSTALL.md).

## Documentation

| Topic | Guide |
|---|---|
| Start here | [Documentation hub](docs/README.md) |
| Install, upgrade, back up, or troubleshoot | [Installation guide](docs/INSTALL.md) |
| Configure environment variables | [Configuration](docs/CONFIGURATION.md) |
| Connect infrastructure and services | [Integration setup](docs/integration-setup.md) |
| Connect Claude or another MCP client | [MCP server](docs/MCP.md) |
| Develop and test PolySIEM | [Development](docs/DEVELOPMENT.md) |
| Use or extend the API | [API and internal contracts](docs/API.md) |

## License

[MIT](LICENSE) © PolySIEM contributors.
