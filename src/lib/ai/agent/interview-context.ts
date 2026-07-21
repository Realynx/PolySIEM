import type { ChatMessage } from "./contract";

/** Leave headroom for the agent system prompt, tool schemas, and its reply. */
export const INTERVIEW_CONTEXT_THRESHOLD = 0.9;
export const INTERVIEW_RECENT_MESSAGE_COUNT = 10;
export const INTERVIEW_CONTEXT_RESERVE_TOKENS = 8_000;

const DEFAULT_COMPACTION_SUMMARY =
  "Confirmed facts from earlier turns were saved into the documentation pages. Read the relevant existing docs before editing or asking follow-up questions.";

export interface InterviewCompactionOptions {
  contextWindowTokens?: number;
  force?: boolean;
  recentMessageCount?: number;
  reserveTokens?: number;
  summary?: string;
  systemPrompt?: string;
}

export interface InterviewCompactionResult {
  messages: ChatMessage[];
  compacted: boolean;
  estimatedTokens: number;
  thresholdTokens: number;
}

/** Conservative dependency-free estimate suitable for deciding when to trim. */
export function estimateInterviewTokens(
  messages: ChatMessage[],
  systemPrompt = "",
): number {
  const chars =
    systemPrompt.length +
    messages.reduce(
      (total, message) =>
        total +
        message.content.length +
        (message.toolCalls ? JSON.stringify(message.toolCalls).length : 0) +
        16,
      0,
    );
  return Math.ceil(chars / 4);
}

/**
 * Compact only after the estimated prompt reaches 90% of the model context,
 * unless the interviewer explicitly requests it. The kickoff and five most
 * recent user/assistant pairs remain verbatim; older facts are represented by
 * the model-authored summary or by the docs-reference fallback.
 */
export function compactInterviewMessages(
  messages: ChatMessage[],
  options: InterviewCompactionOptions = {},
): InterviewCompactionResult {
  const contextWindowTokens = Math.max(1, options.contextWindowTokens ?? 32_768);
  const reserveTokens = Math.max(
    0,
    options.reserveTokens ?? INTERVIEW_CONTEXT_RESERVE_TOKENS,
  );
  const estimatedTokens =
    estimateInterviewTokens(messages, options.systemPrompt) + reserveTokens;
  const thresholdTokens = Math.floor(
    contextWindowTokens * INTERVIEW_CONTEXT_THRESHOLD,
  );
  const recentCount = Math.max(
    4,
    options.recentMessageCount ?? INTERVIEW_RECENT_MESSAGE_COUNT,
  );

  if (
    (!options.force && estimatedTokens < thresholdTokens) ||
    messages.length <= recentCount + 1
  ) {
    return {
      messages,
      compacted: false,
      estimatedTokens,
      thresholdTokens,
    };
  }

  const summary = options.summary?.trim() || DEFAULT_COMPACTION_SUMMARY;
  const kickoff = messages[0];
  const recent = messages.slice(-recentCount);
  const compactedMessages: ChatMessage[] = [
    kickoff,
    {
      role: "assistant",
      content: `Earlier interview turns were compacted to reduce context usage. ${summary}`,
    },
    ...recent.filter((message) => message !== kickoff),
  ];

  return {
    messages: compactedMessages,
    compacted: true,
    estimatedTokens,
    thresholdTokens,
  };
}
