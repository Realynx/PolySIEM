import type { PrismaClient } from "@prisma/client";
import type { ZodType } from "zod";
import type { AuditActor } from "@/lib/audit";
import type { NodeTypeMeta, WorkflowLogLevel } from "./types";

/**
 * The workflow action registry — the expandability seam. Every node kind the
 * engine can execute is an ActionDefinition registered here. Adding a new
 * action = one module in ./actions + one register line below (see README.md).
 */

/** Everything an action's run() can reach. */
export interface RunContext {
  /** Validated trigger input values for this run. */
  input: Record<string, unknown>;
  /** nodeId -> full (unredacted) outputs of already-executed upstream nodes. */
  nodeOutputs: Record<string, Record<string, unknown>>;
  /** Id of the node currently executing. */
  nodeId: string;
  /** Who is running the workflow — passed to audited services. */
  actor: AuditActor;
  /** Prisma-backed data access for actions that query/write PolySIEM data. */
  prisma: PrismaClient;
  /**
   * Workflow-id call chain including the current run (last entry). Pass to
   * executeWorkflow when launching a sub-workflow so cycle/depth guards hold.
   */
  chain: string[];
  /**
   * Emit a console line for this step — shown in the live run tail and kept on
   * the historic run. Secret output values are scrubbed automatically. Use it
   * for progress an operator would want to watch ("connecting to pve1…"),
   * not for dumping payloads.
   */
  log: (message: string, level?: WorkflowLogLevel) => void;
}

export interface ActionDefinition {
  /** Palette + config-form metadata; meta.kind is the registry key. */
  meta: NodeTypeMeta;
  /**
   * Zod schema applied to the node's config AFTER template resolution —
   * the parsed value is what run() receives as args.config.
   */
  configSchema: ZodType;
  /** Execute the action. Returned keys must match meta.outputs. */
  run(args: { config: unknown; ctx: RunContext }): Promise<Record<string, unknown>>;
}

const registry = new Map<string, ActionDefinition>();

export function registerAction(definition: ActionDefinition): void {
  if (registry.has(definition.meta.kind)) {
    throw new Error(`Workflow action "${definition.meta.kind}" is already registered`);
  }
  registry.set(definition.meta.kind, definition);
}

export function getAction(kind: string): ActionDefinition | undefined {
  return registry.get(kind);
}

/** NodeTypeMeta list for GET /api/workflows/catalog and the builder palette. */
export function actionCatalog(): NodeTypeMeta[] {
  return [...registry.values()].map((d) => d.meta);
}

// ---------------------------------------------------------------------------
// Built-in actions — one import + register line per action.
// ---------------------------------------------------------------------------

import { triggerManual } from "./actions/trigger";
import { controlCondition } from "./actions/condition";
import { inventoryAllocateIp } from "./actions/allocate-ip";
import { sshGenerateKey } from "./actions/generate-key";
import { proxmoxInstallSshKey } from "./actions/install-key";
import { docsCreatePage } from "./actions/create-doc";
import { httpWebhook } from "./actions/webhook";
import { notifyMessage } from "./actions/notify-message";
import { workflowRunSub } from "./actions/run-workflow";
import { aiGenerate } from "./actions/ai-generate";
import { credentialsGet } from "./actions/get-credential";
import { controlDelay } from "./actions/delay";
import { logsSearch } from "./actions/logs-search";
import { triggerWebhook } from "./actions/trigger-webhook";
import { triggerSchedule } from "./actions/trigger-schedule";
import { proxmoxCreateContainer } from "./actions/provision-container";
import {
  triggerEsAbsence,
  triggerEsMatch,
  triggerEsMetric,
  triggerEsThreshold,
} from "./actions/trigger-elasticsearch";
import {
  logsAssetActivity,
  logsDigest,
  logsMetric,
  logsStats,
} from "./actions/logs-actions";
import { triggerThreatTicket } from "./actions/trigger-threat-ticket";
import { aiScript } from "./actions/ai-script";
import { censysLookupHost } from "./actions/censys";
import { triggerCensysHostChanged, triggerCensysLookupComplete } from "./actions/trigger-censys";
import { securityTrailsLookup } from "./actions/securitytrails";
import {
  triggerSecurityTrailsLookupComplete,
  triggerSecurityTrailsResultChanged,
} from "./actions/trigger-securitytrails";

registerAction(triggerManual);
registerAction(controlCondition);
registerAction(inventoryAllocateIp);
registerAction(sshGenerateKey);
registerAction(proxmoxInstallSshKey);
registerAction(docsCreatePage);
registerAction(httpWebhook);
registerAction(notifyMessage);
registerAction(workflowRunSub);
registerAction(aiGenerate);
registerAction(credentialsGet);
registerAction(controlDelay);
registerAction(logsSearch);
registerAction(triggerWebhook);
registerAction(triggerSchedule);
registerAction(proxmoxCreateContainer);
registerAction(triggerEsMatch);
registerAction(triggerEsAbsence);
registerAction(triggerEsThreshold);
registerAction(triggerEsMetric);
registerAction(logsStats);
registerAction(logsMetric);
registerAction(logsDigest);
registerAction(logsAssetActivity);
registerAction(triggerThreatTicket);
registerAction(aiScript);
registerAction(censysLookupHost);
registerAction(triggerCensysLookupComplete);
registerAction(triggerCensysHostChanged);
registerAction(securityTrailsLookup);
registerAction(triggerSecurityTrailsLookupComplete);
registerAction(triggerSecurityTrailsResultChanged);
