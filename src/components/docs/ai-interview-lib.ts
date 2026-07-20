import type {
  ChatMessage,
  DocInterviewGoal,
  InterviewServiceCandidate,
  InterviewServicePlan,
} from "@/lib/ai/agent/contract";

/**
 * Pure helpers for the AI documentation interview UI. No React / DOM imports so
 * this stays unit-testable in the node vitest environment.
 */

/**
 * Hidden first user turn that kicks the interview off. It never renders as a
 * bubble (the UI skips messages[0]); it just tells the agent to inspect the
 * real inventory and open with a grounded question.
 */
export function interviewKickoff(goal: DocInterviewGoal): ChatMessage {
  const outcome =
    goal === "document"
      ? "continuously build a useful set of focused documentation pages"
      : goal === "services"
        ? "identify services I confirm and propose inventory entries attached to the exact synced hardware they run on"
        : "continuously build a useful set of focused documentation pages and propose service inventory entries attached to the exact synced hardware they run on";
  return {
    role: "user",
    content: `Interview me so we can ${outcome}. Inspect my real synced infrastructure with read-only tools first, then ask your first focused question about a specific host, VM, container, network, or service you actually find. Ask one question at a time. Do not assume you can SSH into machines; distinguish synced facts from services I confirm.`,
  };
}

export interface InterviewQuestionOption {
  label: string;
  answer: string;
  description?: string;
}

export interface InterviewQuestionPrompt {
  question: string;
  options: InterviewQuestionOption[];
}

function questionArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (typeof args.question === "string") return args;
  const input = args.input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input === "string") {
    try {
      const parsed: unknown = JSON.parse(input);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Invalid model-authored JSON is handled as an absent prompt below.
    }
  }
  return args;
}

/**
 * Extract the last valid structured question from an assistant turn. Tool args
 * are model-authored, so validate them before rendering interactive controls.
 */
export function interviewQuestionPrompt(
  message: ChatMessage,
): InterviewQuestionPrompt | null {
  const calls = message.toolCalls ?? [];
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (call.name !== "ask_question" || call.status === "error") continue;
    const args = questionArgs(call.args);
    const question =
      typeof args.question === "string" ? args.question.trim() : "";
    const rawOptions = args.options;
    if (!question || !Array.isArray(rawOptions)) return null;
    const options = rawOptions
      .map((value): InterviewQuestionOption | null => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return null;
        }
        const option = value as Record<string, unknown>;
        const label =
          typeof option.label === "string" ? option.label.trim() : "";
        const answer =
          typeof option.answer === "string" ? option.answer.trim() : "";
        const description =
          typeof option.description === "string"
            ? option.description.trim()
            : "";
        if (!label || !answer) return null;
        return {
          label,
          answer,
          ...(description ? { description } : {}),
        };
      })
      .filter((value): value is InterviewQuestionOption => value !== null);
    return options.length >= 2 && options.length <= 4
      ? { question, options }
      : null;
  }
  return null;
}

const COMPACTED_INTERVIEW_NOTICE: ChatMessage = {
  role: "assistant",
  content:
    "Earlier interview turns were compacted to reduce token usage. Their confirmed facts were saved into the documentation pages; read the relevant existing docs before editing or asking follow-up questions.",
};

/**
 * Bound repeated prompt tokens during long interviews. The kickoff and recent
 * turns stay verbatim; older confirmed facts remain available through get_doc.
 */
export function compactInterviewMessages(
  messages: ChatMessage[],
  maxMessages = 16,
): ChatMessage[] {
  if (messages.length <= maxMessages) return messages;
  const budget = Math.max(4, maxMessages);
  return [
    messages[0],
    COMPACTED_INTERVIEW_NOTICE,
    ...messages.slice(-(budget - 2)),
  ];
}

/** Backwards-compatible default for callers that do not expose the setup step. */
export const INTERVIEW_KICKOFF = interviewKickoff("both");

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string")
    throw new Error(`${field} must be text or null.`);
  return value.trim() || null;
}

/** Parse and defensively validate the model's JSON-only service proposal. */
export function parseInterviewServicePlan(raw: string): InterviewServicePlan {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    throw new Error(
      "The interviewer returned an invalid service proposal. Retry the review.",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The service proposal has the wrong shape.");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.services)) {
    throw new Error("The service proposal is missing its services list.");
  }
  const services: InterviewServiceCandidate[] = record.services.map(
    (item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`Service ${index + 1} has the wrong shape.`);
      }
      const service = item as Record<string, unknown>;
      const target = service.target;
      if (!target || typeof target !== "object" || Array.isArray(target)) {
        throw new Error(`Service ${index + 1} has no hardware target.`);
      }
      const targetRecord = target as Record<string, unknown>;
      const kind = targetRecord.kind;
      const id = nullableString(targetRecord.id, "target id");
      const targetName = nullableString(targetRecord.name, "target name");
      const name = nullableString(service.name, "service name");
      const evidence = nullableString(service.evidence, "service evidence");
      if (!name || !evidence || !id || !targetName) {
        throw new Error(
          `Service ${index + 1} is missing a name, target, or evidence.`,
        );
      }
      if (kind !== "device" && kind !== "vm" && kind !== "container") {
        throw new Error(
          `Service ${index + 1} has an unsupported hardware target.`,
        );
      }
      const protocol = service.protocol;
      if (
        protocol !== null &&
        protocol !== undefined &&
        protocol !== "http" &&
        protocol !== "https" &&
        protocol !== "tcp" &&
        protocol !== "udp"
      ) {
        throw new Error(`Service ${index + 1} has an unsupported protocol.`);
      }
      const port = service.port;
      if (
        port !== null &&
        port !== undefined &&
        (!Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535)
      ) {
        throw new Error(`Service ${index + 1} has an invalid port.`);
      }
      return {
        name,
        url: nullableString(service.url, "service URL"),
        port: port === null || port === undefined ? null : Number(port),
        protocol: protocol ?? null,
        description: nullableString(service.description, "service description"),
        target: { kind, id, name: targetName },
        evidence,
      };
    },
  );
  const notes = Array.isArray(record.notes)
    ? record.notes
        .map((note) => (typeof note === "string" ? note.trim() : ""))
        .filter(Boolean)
    : [];
  return { services, notes };
}

/** Merge/append a streamed tool call into an existing list by id (last wins). */
export function upsertToolCall<T extends { id: string }>(
  calls: T[],
  call: T,
): T[] {
  const index = calls.findIndex((c) => c.id === call.id);
  if (index === -1) return [...calls, call];
  const next = calls.slice();
  next[index] = call;
  return next;
}

/** Map an HTTP failure status to a friendly, non-technical message. */
export function interviewFailureMessage(status: number): string {
  if (status === 404 || status === 501) {
    return "The documentation interviewer isn't available yet. Try again once the AI service is set up.";
  }
  if (status === 401)
    return "Your session has expired — sign in again to continue.";
  if (status === 403)
    return "You do not have permission to use the documentation interviewer.";
  if (status === 429)
    return "The AI is busy right now. Give it a moment and retry.";
  return `The documentation interviewer request failed (HTTP ${status}).`;
}
