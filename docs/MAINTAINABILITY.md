# PolySIEM maintainability guide

This guide describes the boundaries current code follows. Prefer these seams when adding features or refactoring existing ones.

## Dependency direction

1. API routes authenticate, parse transport input, and delegate.
2. Services enforce application policy, coordinate persistence, audit mutations, and translate domain failures into `ApiError`.
3. Integration drivers adapt approved provider-neutral requests to external APIs.
4. Pure contracts, validators, and helpers must not depend on React, Next responses, Prisma clients, or provider SDKs unless that dependency is their explicit responsibility.

Avoid calling integration clients directly from routes, components, or workflow actions. Reuse the guarded service operation so UI, workflows, and future tools receive the same validation and audit behavior.

## Integration extensions

`IntegrationDriver` is capability-driven. Add `inventorySynchronizer`, `containerProvisioner`, or a future explicit capability to the provider driver. Do not add provider-type switches to the scheduler or orchestration services.

Mutation capabilities use narrow allowlist contracts such as `ContainerCreateRequest`. Do not expose arbitrary provider URLs, paths, methods, or request bodies through workflows or UI features. Provider-specific error interpretation belongs to the provider adapter through a framework-neutral descriptor.

See [ADR 0001](adr/0001-capability-driven-integration-drivers.md).

## Service organization

Keep entity operations explicit when auditing, ownership policy, or Prisma result shapes differ. The inventory facade at `src/lib/services/inventory.ts` preserves the public API while cohesive modules under `src/lib/services/inventory/` own each entity family.

Share policies and query helpers only when their semantics are genuinely identical. Do not introduce a generic repository that hides audit actions, integration-owned-field rules, or relation projections.

Focused boundary policies belong in focused modules. For example, Elasticsearch upstream-error normalization lives in `src/lib/services/elasticsearch-upstream.ts`, not in one of its callers.

## Workflow extensions

Node metadata and client-safe workflow contracts live in `src/lib/workflows/types.ts`. The engine and builder consume the same trigger-kind and trigger-parameter rules. Add catalog fields additively and preserve legacy re-exports when external consumers may import them.

Workflow actions should be small adapters around an existing service operation. Shared action execution belongs in a narrowly named helper when behavior is identical; caller-specific error wording remains caller-owned.

Never add an arbitrary infrastructure API action. Add a reviewed action with a strict schema and explicit outputs.

## Frontend organization

Use `src/components/shared/api-envelope.ts` for PolySIEM API envelopes and `useDebounced` for delayed inputs. Feature wrappers may retain their request construction and user-facing fallback copy.

For stateful panels, separate transport/state transitions from presentation once the controller becomes independently understandable. `useDocInterview` is the model: the hook owns SSE and phase transitions; the panel owns rendering and review UI.

Avoid extracting tiny one-use visual fragments solely to reduce line count. Extract cohesive behavior, reusable policy, or independently testable transformations.

## Verification expectations

- Preserve public barrels and contracts with explicit export tests when moving modules.
- Add pure tests for selection, validation, translation, redaction, and initialization helpers.
- Add orchestration tests when a service coordinates provider mutation, synchronization, reconciliation, and auditing.
- Run targeted tests and lint while iterating, then `npm run typecheck`, `npm run lint`, and `npm test` before handoff.
- Treat the existing Vite warning for the variable MCP integration import separately; it is not caused by these boundaries.

## Remaining hotspots

These are candidates for later bounded refactors, not invitations to rewrite them wholesale:

1. `components/topology/footprint-map.tsx` and `network-access-map.tsx`: separate graph construction/routing from interaction and rendering, backed by graph regression tests.
2. `components/settings/backup-manager.tsx`: separate destination CRUD, scheduling, history, and restore flows.
3. `lib/ai/agent/runtime.ts`: separate mode selection, streaming, persistence, and fallback orchestration.
4. `lib/mcp/server.ts`: split tool registration/catalog definition from authorization and dispatch.
5. `components/workflows/builder.tsx` and `lib/workflows/engine.ts`: extract cohesive editing and validation subsystems without duplicating the canonical workflow contract.
6. Inventory mutations and audit writes: evaluate transactions where a persisted mutation without its audit record would be unacceptable.
