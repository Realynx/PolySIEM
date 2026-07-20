# Workflows rules engine

User-buildable automation workflows: a DAG of one manual trigger, action
nodes, and condition nodes, stored as JSON (`Workflow.graph`, shape in
`types.ts` — the frozen contract shared with the builder UI) and executed
sequentially by `executor.ts`.

Module map:

| File | Role |
| --- | --- |
| `types.ts` | Frozen shared contract (graph shape, catalog metadata, run DTOs, API surface). Additive changes only. |
| `engine.ts` | Pure core: graph validation, topo order, branch gating, `{{...}}` template resolution, secret redaction. No server imports. |
| `free-ip.ts` | Pure free-IP math used by `inventory.allocate-ip`. |
| `registry.ts` | Action registry (`ActionDefinition`, `registerAction`, `actionCatalog`). |
| `actions/` | One module per action kind. |
| `executor.ts` | Server-side run loop: creates `WorkflowRun`/`WorkflowRunStep` rows, executes, persists redacted outputs, returns one-time secrets. |
| `service.ts` | Workflow/run CRUD + DTO mapping used by the API routes and MCP tools. |
| `schemas.ts` | Zod schemas for API bodies. |

## Adding a new action

Two steps — nothing else needs to change (catalog, validation, the builder
palette, execution, and MCP all derive from the registry):

1. **Create one module in `actions/`**, exporting an `ActionDefinition`:

   ```ts
   // src/lib/workflows/actions/wake-machine.ts
   import { z } from "zod";
   import type { ActionDefinition } from "../registry";

   const configSchema = z.object({ macAddress: z.string().min(1) });

   export const powerWakeMachine: ActionDefinition = {
     meta: {
       kind: "power.wake-machine",          // unique "<category>.<name>" key
       title: "Wake machine",
       description: "Sends a Wake-on-LAN packet.",
       category: "inventory",               // NodeCategory in types.ts
       inputs: [
         // FieldSpec[] — drives the builder's config form AND validation.
         // string/text fields accept {{input.x}} / {{nodes.id.key}} templates
         // by default; set templateable on other types to opt in.
         { key: "macAddress", label: "MAC address", type: "string", required: true },
       ],
       outputs: [
         // OutputSpec[] — declare every key run() returns. Mark secrets with
         // secret: true; they are redacted before persistence and only
         // returned once in the run response.
         { key: "sent", label: "Packet sent" },
       ],
     },
     configSchema, // parsed AFTER template resolution; the result is run()'s config
     async run({ config, ctx }) {
       const { macAddress } = configSchema.parse(config);
       // ctx = { input, nodeOutputs, nodeId, actor, prisma } — use audited
       // services from src/lib/services where one exists.
       return { sent: "true" };
     },
   };
   ```

2. **Register it in `registry.ts`** (import + register line at the bottom):

   ```ts
   import { powerWakeMachine } from "./actions/wake-machine";
   registerAction(powerWakeMachine);
   ```

Guidelines:

- `run()` throws on failure — the message becomes the step error verbatim, so
  make it actionable (see `install-key.ts` reusing the /keys 403 guidance).
- Never return private key material or credentials in a non-secret output.
- Reuse existing service functions (they audit + validate); keep any pure
  math in its own importable module so it can be unit-tested.
- Add engine-level tests only if you extend `engine.ts` itself; action
  behavior against real data is exercised via `POST /api/workflows/[id]/run`.
