# PolySIEM documentation

Pick the guide that matches what you're trying to do.

## Use and operate PolySIEM

- [Installation, upgrades, backup, and troubleshooting](INSTALL.md) — every supported deployment path, plus how to recover when something breaks.
- [Configuration](CONFIGURATION.md) — environment variables, secrets, URLs, and deployment settings.
- [Integration setup](integration-setup.md) — how to create least-privilege credentials for your infrastructure, security, and AI providers, and how the demo integrations work.
- [Security and threat intelligence](SECURITY.md) — security scoring, AI providers, Threat watch, AlienVault OTX, and the Suricata rules export.
- [Proxmox logs with Filebeat](filebeat-proxmox.md) — ship Proxmox host logs into Elasticsearch so the log explorer can see them.
- [MCP server](MCP.md) — create scoped API tokens and connect Claude or any other Streamable HTTP MCP client.

## Develop and extend PolySIEM

- [Development](DEVELOPMENT.md) — local setup, common commands, architecture, testing, and the public demo stack.
- [API and internal contracts](API.md) — route inventory, shared modules, and API conventions.
- [Maintainability guide](MAINTAINABILITY.md) — where the dependency boundaries are and where to hook in new features.
- [Domain context](../CONTEXT.md) — the language and identity rules behind inventory and network evidence.
- [Roadmap](ROADMAP.md) — what's planned next.

## Architecture decisions

- [ADR 0001: Capability-driven integration drivers](adr/0001-capability-driven-integration-drivers.md)
- [ADR 0002: Cross-integration network evidence](adr/0002-cross-integration-network-evidence.md)

Return to the [project overview](../README.md).
