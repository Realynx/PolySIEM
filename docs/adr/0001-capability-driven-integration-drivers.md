# ADR 0001: Capability-driven integration drivers

Status: Accepted

## Context

PolySIEM integrations do not all behave alike. Some query data live, some synchronize inventory, and some can mutate external infrastructure. Dispatching on integration type in orchestration code made every new provider require edits in central services. At the other extreme, exposing a generic provider API proxy would make workflows and UI features difficult to validate, authorize, audit, and maintain safely.

## Decision

`IntegrationDriver` is the registry boundary for provider behavior. Connection testing is mandatory; other behaviors are optional, explicit capabilities such as `inventorySynchronizer` and `containerProvisioner`.

Orchestration code asks the selected driver for a capability instead of branching on provider type. A provider is eligible for a feature only when it implements that capability.

Mutating capabilities accept provider-facing allowlist contracts. The container provisioner receives `ContainerCreateRequest`, which contains only reviewed creation fields. UI identifiers, workflow metadata, credentials, arbitrary URLs, HTTP methods, provider paths, and raw request bodies must not cross this boundary.

Request validation, authorization, auditing, provider selection, and inventory reconciliation remain service-layer responsibilities. Provider drivers translate the approved request into their native API.

## Consequences

- Adding a new inventory or provisioning provider is localized to its driver and capability implementation.
- Live-query integrations are not special-cased in the synchronization engine or scheduler.
- Workflows and UI features reuse the same guarded service operation.
- Provider contracts remain intentionally narrower than their complete upstream APIs.
- Each provisioning provider owns `translateFailure`, returning a framework-neutral status/code/message descriptor. Proxmox-specific remediation text therefore cannot become the default for unrelated providers.
- Some explicit mapping code is retained at service boundaries. This duplication is preferred over leaking request schemas or arbitrary provider payloads into drivers.
