/**
 * Workflow contract — the FROZEN shared shapes between the rules engine
 * (src/lib/workflows/**, API routes) and the builder UI
 * (src/components/workflows/**, /workflows pages).
 *
 * Both sides are built in parallel against this file: changes must be
 * additive-only and coordinated. No imports from server-only modules here —
 * this file is client-safe.
 *
 * Concepts:
 * - A workflow is a DAG: one manual trigger node, action nodes, and condition
 *   nodes whose outgoing edges carry a "true"/"false" branch.
 * - Node config values are plain JSON; string fields may contain template
 *   references resolved at run time from the run context:
 *     {{input.<paramKey>}}            — trigger input parameter
 *     {{nodes.<nodeId>.<outputKey>}}  — an upstream node's output
 * - Secret outputs (e.g. a generated private key) live only in the in-memory
 *   run context and the one-time run response; they are REDACTED before any
 *   persistence or logging.
 */

// ---------- graph ----------

export interface WorkflowGraph {
  nodes: WorkflowNodeSpec[];
  edges: WorkflowEdgeSpec[];
}

export interface WorkflowNodeSpec {
  id: string;
  /** Node type key: "trigger.manual", "control.condition", or an action kind like "ssh.generate-key". */
  kind: string;
  /** User-supplied display label; null falls back to the node type title. */
  label: string | null;
  /** Canvas position (React Flow coordinates). */
  position: { x: number; y: number };
  /** Node-kind-specific settings, validated against the kind's FieldSpec list. */
  config: Record<string, unknown>;
}

export interface WorkflowEdgeSpec {
  id: string;
  source: string;
  target: string;
  /** Which branch of a condition node this edge follows; null for plain edges. */
  branch: "true" | "false" | null;
}

/** A problem found by graph validation, anchored to a node when possible. */
export interface GraphIssue {
  nodeId: string | null;
  message: string;
}

// ---------- node-type metadata (palette + config forms) ----------

export type FieldType =
  | "string" // single-line, templateable by default
  | "text" // multi-line, templateable by default
  | "number"
  | "boolean"
  | "select" // static options
  | "network" // entity picker: Network rows
  | "vm" // entity picker: VirtualMachine rows
  | "device" // entity picker: Device rows
  | "integration" // entity picker: configured Integration rows
  | "workflow"; // entity picker: other Workflow rows (sub-workflow launch)

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  help?: string;
  placeholder?: string;
  /** Static options for type "select". */
  options?: FieldOption[];
  /** Whether {{...}} template refs are accepted; defaults true for string/text, false otherwise. */
  templateable?: boolean;
  /** Initial builder value for newly-added nodes. Must be JSON-safe. */
  defaultValue?: string | number | boolean;
}

export interface OutputSpec {
  key: string;
  label: string;
  /** Secret outputs are redacted from persisted steps and only returned once in the run response. */
  secret?: boolean;
}

export type NodeCategory =
  | "trigger"
  | "control"
  | "inventory"
  | "ssh"
  | "proxmox"
  | "docs"
  | "http"
  | "notify"
  | "ai"
  | "logs"
  | "workflow";

/** Served by GET /api/workflows/catalog as { data: NodeTypeMeta[] }. */
export interface NodeTypeMeta {
  kind: string;
  title: string;
  description: string;
  category: NodeCategory;
  inputs: FieldSpec[];
  outputs: OutputSpec[];
}

// ---------- trigger contract ----------

/** Every trigger node kind shares this prefix, regardless of trigger flavor. */
export const TRIGGER_KIND_PREFIX = "trigger." as const;

export function isTriggerKind(kind: string): boolean {
  return kind.startsWith(TRIGGER_KIND_PREFIX);
}

/** Canonical run-parameter types shared by validation and the builder UI. */
export const TRIGGER_PARAM_TYPES = [
  "string",
  "number",
  "boolean",
  "network",
  "vm",
  "device",
] as const;

export type TriggerParamType = (typeof TRIGGER_PARAM_TYPES)[number];

export function isTriggerParamType(value: unknown): value is TriggerParamType {
  return (
    typeof value === "string" &&
    (TRIGGER_PARAM_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Config shape of the "trigger.manual" node: user-defined run parameters,
 * rendered as a form when the workflow is executed. Stored as
 * config = { params: TriggerParam[] }.
 */
export interface TriggerParam {
  key: string;
  label: string;
  type: TriggerParamType;
  required: boolean;
  help?: string;
}

// ---------- runs ----------

export type WorkflowRunStatus = "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";
export type WorkflowStepStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";

export interface WorkflowRunStepDto {
  id: string;
  nodeId: string;
  kind: string;
  label: string;
  status: WorkflowStepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  /** Outputs with secret keys replaced by "[redacted]". */
  output: Record<string, unknown> | null;
  error: string | null;
}

export type WorkflowLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/** One console line of a run, ordered by `seq`. nodeId is null for run-level lines. */
export interface WorkflowRunLogDto {
  seq: number;
  nodeId: string | null;
  level: WorkflowLogLevel;
  message: string;
  createdAt: string;
}

export interface WorkflowRunDto {
  id: string;
  workflowId: string;
  workflowName: string;
  status: WorkflowRunStatus;
  /** What started the run: "manual", "webhook", "schedule", or "workflow" (sub-launch). */
  trigger: string;
  /** Trigger input values as submitted (validated against the trigger params). */
  input: Record<string, unknown>;
  startedAt: string;
  finishedAt: string | null;
  steps: WorkflowRunStepDto[];
  error: string | null;
}

export interface WorkflowDto {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  graph: WorkflowGraph;
  createdAt: string;
  updatedAt: string;
  lastRun: { id: string; status: WorkflowRunStatus; startedAt: string } | null;
}

/**
 * Response of POST /api/workflows/[id]/run — execution is synchronous in v1.
 * `secrets` maps nodeId -> { outputKey -> value } for secret outputs and is
 * returned exactly once; it is never stored.
 */
export interface WorkflowRunResult {
  run: WorkflowRunDto;
  secrets?: Record<string, Record<string, string>>;
}

// ---------- API surface (implemented by the engine, consumed by the UI) ----------
// GET    /api/workflows                 -> { data: WorkflowDto[] }
// POST   /api/workflows                 -> { data: WorkflowDto }         (create; admin)
// GET    /api/workflows/catalog         -> { data: NodeTypeMeta[] }
// GET    /api/workflows/[id]            -> { data: WorkflowDto }
// PATCH  /api/workflows/[id]            -> { data: WorkflowDto }         (save graph/meta; admin)
// DELETE /api/workflows/[id]            -> { data: { ok: true } }        (admin)
// POST   /api/workflows/[id]/validate   -> { data: { issues: GraphIssue[] } }
// POST   /api/workflows/[id]/run        -> { data: WorkflowRunResult }   (admin; body { input })
// GET    /api/workflows/[id]/runs       -> { data: WorkflowRunDto[] }    (without steps)
// GET    /api/workflows/runs            -> { data: WorkflowRunDto[] }    (global, without steps)
// GET    /api/workflows/runs/[runId]    -> { data: WorkflowRunDto }      (with steps)
// GET    /api/workflows/runs/[runId]/logs?after=<seq>
//                                       -> { data: { lines: WorkflowRunLogDto[]; nextSeq: number; done: boolean } }
