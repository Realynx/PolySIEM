# PolySIEM maintainability guide

This guide describes the boundaries the current code already follows. When you add a feature or refactor an existing one, work with these seams rather than around them.

## Dependency direction

The layers, from the outside in:

1. API routes authenticate, parse transport input, and delegate.
2. Services enforce application policy, coordinate persistence, audit mutations, and translate domain failures into `ApiError`.
3. Integration drivers adapt approved provider-neutral requests to external APIs.
4. Pure contracts, validators, and helpers must not depend on React, Next responses, Prisma clients, or provider SDKs unless that dependency is their explicit responsibility.

Don't call integration clients directly from routes, components, or workflow actions. Go through the guarded service operation instead, so the UI, workflows, and whatever tools come later all get the same validation and audit behavior.

## Integration extensions

`IntegrationDriver` is capability-driven. When a provider gains a new ability, add `inventorySynchronizer`, `containerProvisioner`, or a new explicit capability to that provider's driver. What you should not do is add provider-type switches to the scheduler or orchestration services.

Mutation capabilities use narrow allowlist contracts such as `ContainerCreateRequest`. Never expose arbitrary provider URLs, paths, methods, or request bodies through workflows or UI features. If a provider returns errors that need interpretation, that logic belongs in the provider adapter, surfaced through a framework-neutral descriptor.

The reasoning is written up in [ADR 0001](adr/0001-capability-driven-integration-drivers.md).

## Service organization

Keep entity operations explicit whenever auditing, ownership policy, or Prisma result shapes differ between entities. The inventory facade at `src/lib/services/inventory.ts` keeps the public API stable while cohesive modules under `src/lib/services/inventory/` each own an entity family.

Only share policies and query helpers when their semantics are genuinely identical, not merely similar. And resist the urge to introduce a generic repository. It would hide audit actions, integration-owned-field rules, and relation projections, which is exactly what we don't want hidden.

Focused boundary policies belong in focused modules. Elasticsearch upstream-error normalization, for example, lives in `src/lib/services/elasticsearch-upstream.ts` rather than inside one of its callers.

Cross-transport orchestration belongs in a service as well. MCP and the AI agent both delegate integration synchronization to `src/lib/services/integration-sync.ts`, which owns target eligibility, lookup, execution order, and result shaping. Keep transport-specific authorization and tool descriptions in their registries; do not copy application policy into those entry points.

The AI tool facade at `src/lib/ai/agent/tools/index.ts` owns only tool availability by mode, role, and demo state. Capability modules beside it own research, external-provider, application-read, write, and interview definitions. Callers should continue importing the facade rather than depending on individual capability modules.

Likewise, `src/lib/mcp/server.ts` is only the stable MCP assembly facade. Domain-focused sibling modules own overview/research, inventory reads and writes, documentation, integrations, and credentials. Preserve the facade and catalog registration contract when adding or reorganizing MCP tools.

## Workflow extensions

Node metadata and client-safe workflow contracts live in `src/lib/workflows/types.ts`, and the engine and builder consume the same trigger-kind and trigger-parameter rules. Add catalog fields additively, and preserve legacy re-exports when external consumers may still import them.

`src/lib/workflows/engine.ts` is the stable client-safe facade. Template resolution, graph execution, graph validation, conditions, trigger input, and secret-output policy live in focused sibling modules; consumers should import the facade unless they are implementing one of those policies. Builder-only React Flow translation belongs in `src/components/workflows/builder-flow.ts`, outside the domain engine.

A workflow action should be a small adapter around an existing service operation. If two actions genuinely share execution behavior, put it in a narrowly named helper, but keep caller-specific error wording with the caller.

Never add an arbitrary infrastructure API action. Add a reviewed action with a strict schema and explicit outputs.

## Frontend organization

Use `src/components/shared/api-envelope.ts` for PolySIEM API envelopes and `useDebounced` for delayed inputs. Feature wrappers can keep their own request construction and user-facing fallback copy.

For stateful panels, split transport and state transitions from presentation once the controller becomes independently understandable. `useDocInterview` is the pattern to copy: the hook owns SSE and phase transitions, the panel owns rendering and the review UI.

When desktop and mobile presentations share hierarchy, fallback, query-key, or payload policy, put that policy in a tested feature model and keep the presentations independent. Provider-heavy forms follow the same rule: `integration-form-fields.tsx` is the stable dispatcher, while provider-specific field groups live under `integration-fields/`.

Server pages should authenticate, load a view model, and render. The access-map page follows this boundary: its server-only loader owns queries and final anonymization, while pure sibling modules assemble provider, physical-network, and Proxmox projections.

Don't extract tiny one-use visual fragments just to shrink a file. Extract when you have cohesive behavior, reusable policy, or a transformation worth testing on its own.

## Verification expectations

- When moving modules, preserve public barrels and contracts, with explicit export tests to prove it.
- Add pure tests for selection, validation, translation, redaction, and initialization helpers.
- Add orchestration tests when a service coordinates provider mutation, synchronization, reconciliation, and auditing.
- Run targeted tests and lint while iterating, then `npm run typecheck`, `npm run lint`, and `npm test` before handoff.
- The existing Vite warning for the variable MCP integration import is a separate issue; these boundaries don't cause it.

## Remaining hotspots

These are candidates for later bounded refactors. They are not invitations to rewrite anything wholesale.

1. `components/topology/footprint-map.tsx` and `network-access-map.tsx`: continue separating interaction state from rendering; graph construction and routing now have focused modules and regression tests.
2. `components/settings/backup-manager.tsx`: separate destination CRUD, scheduling, history, and restore flows.
3. `lib/ai/agent/runtime.ts`: separate mode selection, streaming, persistence, and fallback orchestration.
4. `components/workflows/builder.tsx`: extract cohesive editing/controller state without duplicating the canonical workflow contract or builder-flow model.
5. Inventory mutations and audit writes: evaluate transactions where a persisted mutation without its audit record would be unacceptable.
