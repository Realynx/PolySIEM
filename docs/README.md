# PolySIEM documentation

Welcome to the PolySIEM documentation. Choose a guide based on what you want to do.

## Use and operate PolySIEM

- [Installation, upgrades, backup, and troubleshooting](INSTALL.md) — every supported deployment path and the full recovery workflow.
- [Configuration](CONFIGURATION.md) — environment variables, secrets, URLs, and deployment settings.
- [Integration setup](integration-setup.md) — least-privilege credentials for infrastructure, security, and AI providers, plus demo integrations.
- [Security and threat intelligence](SECURITY.md) — security scoring, AI providers, Threat watch, AlienVault OTX, and the Suricata rules export.
- [Proxmox logs with Filebeat](filebeat-proxmox.md) — send Proxmox host logs to Elasticsearch for the log explorer.
- [MCP server](MCP.md) — create scoped API tokens and connect Claude or another Streamable HTTP MCP client.

## Develop and extend PolySIEM

- [Development](DEVELOPMENT.md) — local setup, common commands, architecture, testing, and the public demo stack.
- [API and internal contracts](API.md) — route inventory, shared modules, and API conventions.
- [Maintainability guide](MAINTAINABILITY.md) — dependency boundaries and preferred extension points.
- [Domain context](../CONTEXT.md) — the language and identity rules behind inventory and network evidence.
- [Roadmap](ROADMAP.md) — planned areas of product development.

## Architecture decisions

- [ADR 0001: Capability-driven integration drivers](adr/0001-capability-driven-integration-drivers.md)
- [ADR 0002: Cross-integration network evidence](adr/0002-cross-integration-network-evidence.md)

Return to the [project overview](../README.md).
