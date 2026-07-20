import type {
  AgentStreamEvent,
  AgentToolCall,
  ChatMessage,
} from "@/lib/ai/agent/contract";

/**
 * Pure transcript state machine for the chat dock. The hook feeds it user
 * actions and decoded stream events; everything here is unit-testable.
 */

export interface ChatDraft {
  content: string;
  toolCalls: AgentToolCall[];
}

export type ChatStatus = "idle" | "streaming" | "error";

export interface ChatTranscriptState {
  /** Completed turns, in ChatMessage shape (what gets POSTed back). */
  messages: ChatMessage[];
  /** The in-flight assistant turn while streaming, else null. */
  draft: ChatDraft | null;
  status: ChatStatus;
  error: string | null;
}

export const initialTranscriptState: ChatTranscriptState = {
  messages: [],
  draft: null,
  status: "idle",
  error: null,
};

export type ChatTranscriptAction =
  | { type: "send"; text: string }
  /** Retry after an error: stream again over the existing messages. */
  | { type: "resend" }
  | { type: "event"; event: AgentStreamEvent }
  | { type: "fail"; message: string }
  /** User pressed stop: keep whatever streamed as a (partial) assistant turn. */
  | { type: "stop" }
  | { type: "reset" }
  | { type: "hydrate"; messages: ChatMessage[] };

function upsertToolCall(calls: AgentToolCall[], call: AgentToolCall): AgentToolCall[] {
  const index = calls.findIndex((c) => c.id === call.id);
  if (index === -1) return [...calls, call];
  const next = calls.slice();
  next[index] = call;
  return next;
}

/** Running calls in a finalized turn would spin forever — mark them errored. */
function settleToolCalls(calls: AgentToolCall[]): AgentToolCall[] {
  return calls.map((c) =>
    c.status === "running" ? { ...c, status: "error" as const, resultPreview: c.resultPreview ?? "Interrupted" } : c,
  );
}

function finalizeDraft(state: ChatTranscriptState): ChatMessage[] {
  const { draft } = state;
  if (!draft || (!draft.content && draft.toolCalls.length === 0)) return state.messages;
  const toolCalls = settleToolCalls(draft.toolCalls);
  return [
    ...state.messages,
    {
      role: "assistant",
      content: draft.content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    },
  ];
}

export function transcriptReducer(
  state: ChatTranscriptState,
  action: ChatTranscriptAction,
): ChatTranscriptState {
  switch (action.type) {
    case "send":
      return {
        messages: [...state.messages, { role: "user", content: action.text }],
        draft: { content: "", toolCalls: [] },
        status: "streaming",
        error: null,
      };

    case "resend":
      return { ...state, draft: { content: "", toolCalls: [] }, status: "streaming", error: null };

    case "event": {
      const { event } = action;
      switch (event.type) {
        case "token": {
          const draft = state.draft ?? { content: "", toolCalls: [] };
          return { ...state, draft: { ...draft, content: draft.content + event.text } };
        }
        case "tool_call":
        case "tool_result": {
          const draft = state.draft ?? { content: "", toolCalls: [] };
          return {
            ...state,
            draft: { ...draft, toolCalls: upsertToolCall(draft.toolCalls, event.call) },
          };
        }
        case "done":
          return {
            messages: [
              ...state.messages,
              {
                role: "assistant",
                content: event.content,
                ...(event.toolCalls.length > 0 ? { toolCalls: event.toolCalls } : {}),
              },
            ],
            draft: null,
            status: "idle",
            error: null,
          };
        case "error":
          // Discard the partial draft so the transcript still ends with the
          // user's message — retry can simply re-stream over it.
          return { ...state, draft: null, status: "error", error: event.message };
        default:
          // "report" (investigate-only) and future event types: ignore.
          return state;
      }
    }

    case "fail":
      return { ...state, draft: null, status: "error", error: action.message };

    case "stop":
      if (state.status !== "streaming") return state;
      return { messages: finalizeDraft(state), draft: null, status: "idle", error: null };

    case "reset":
      return initialTranscriptState;

    case "hydrate":
      return { messages: action.messages, draft: null, status: "idle", error: null };

    default:
      return state;
  }
}

/** True when a retry makes sense (an errored exchange ending on a user turn). */
export function canRetry(state: ChatTranscriptState): boolean {
  return (
    state.status === "error" &&
    state.messages.length > 0 &&
    state.messages[state.messages.length - 1].role === "user"
  );
}
