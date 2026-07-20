# ADR 0002: Derive cross-integration network identity from source-owned evidence

Status: Accepted

## Context

Compute integrations know durable workload identity and configured interfaces, while network integrations often know the addresses those interfaces actually use. No single provider has a complete view: Proxmox can read static LXC configuration and sometimes guest-agent data, while OPNsense can observe DHCP and neighbor entries for both containers and VMs.

Persisting another provider's observation directly onto a Proxmox-owned interface would make results depend on sync order. A later partial sync could erase evidence, and deleting one integration could silently mutate another integration's inventory.

## Decision

Integration-owned rows remain source-owned evidence. Cross-integration identity is resolved in derived read models used by footprint and access views.

Configured interface addresses are direct claims. DHCP and neighbor rows are observed claims. An observed address may attach to an asset when its normalized MAC matches exactly one active asset interface. Ambiguous or unmatched observations remain visible as independent clients. Hostname-only matching is not used.

Proxmox datacenter, security-group, and guest-local firewall rules remain workload-policy evidence. They are modeled separately from gateway policy and contribute a separate enforcement layer to access views.

## Consequences

- Integrations can be added, removed, and synced in any order without overwriting one another's evidence.
- The footprint improves as more integrations are connected, while still working with partial data.
- Provenance remains explainable: configured and observed claims can be distinguished.
- MAC reuse or duplicate MAC configuration produces an unresolved observation rather than an unsafe merge.
- Read models perform conservative reconciliation work instead of relying on one canonical mutable address row.
