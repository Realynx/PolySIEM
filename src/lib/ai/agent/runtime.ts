/**
 * Public facade for the LangChain agent runtime.
 *
 * Execution concerns live in focused sibling modules; re-exports here preserve
 * the established import path for routes, workers, tests, and scripts.
 */
import "server-only";

export { __setForceReportFailure } from "./runtime-core";
export type { AgentRunOptions } from "./runtime-core";

export { runInvestigation } from "./runtime-investigation";
export type { InvestigateInput } from "./runtime-investigation";

export {
  runChat,
  runDocInterview,
  runScript,
} from "./runtime-conversation";
export type {
  DocInterviewMode,
  DocInterviewOptions,
  ScriptRunOptions,
} from "./runtime-conversation";
