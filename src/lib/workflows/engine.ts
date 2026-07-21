/**
 * Client-safe workflow policy facade.
 *
 * Keep consumers importing from this module while each cohesive policy lives
 * in a focused, independently testable module. This file must remain free of
 * server-only dependencies.
 */

import { TRIGGER_KIND_PREFIX } from "./types";

export { isTriggerKind, TRIGGER_PARAM_TYPES } from "./types";
export {
  blockingIssues,
  CONDITION_KIND,
  isBlockingIssue,
  TRIGGER_KIND,
  validateGraph,
  WARNING_PREFIX,
} from "./graph-validation";
export {
  ancestorsOf,
  readyNodes,
  shouldRunNode,
  templateNodeRefs,
  topologicalOrder,
} from "./graph-execution";
export type { NodeRunState } from "./graph-execution";
export {
  collectTemplateRefs,
  resolveConfig,
  resolveTemplateString,
  TemplateError,
} from "./template-resolution";
export type { TemplateRef, TemplateScope } from "./template-resolution";
export { collectSecrets, REDACTED, redactOutput } from "./output-secrets";
export { CONDITION_OPS, evaluateCondition } from "./conditions";
export type { ConditionOp } from "./conditions";
export { validateRunInput, validateTriggerParams } from "./trigger-input";

/** Every trigger kind starts the graph; exactly one is active for a run. */
export const TRIGGER_PREFIX = TRIGGER_KIND_PREFIX;
