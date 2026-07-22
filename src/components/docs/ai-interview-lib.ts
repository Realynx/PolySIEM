import type {
  ChatMessage,
  DocInterviewGoal,
  InterviewServiceCandidate,
  InterviewServicePlan,
} from "@/lib/ai/agent/contract";
export {
  compactInterviewMessages,
  estimateInterviewTokens,
} from "@/lib/ai/agent/interview-context";

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
    content: `Interview me so we can ${outcome}. Inspect my real synced infrastructure with read-only tools first, then ask 1-5 focused questions about specific hosts, VMs, containers, networks, or services you actually find. Do not assume you can SSH into machines; distinguish synced facts from services I confirm.`,
  };
}

export interface InterviewQuestionOption {
  label: string;
  answer: string;
  description?: string;
}

export interface InterviewQuestion {
  id: string;
  question: string;
  options: InterviewQuestionOption[];
}

export interface InterviewQuestionPrompt {
  id: string;
  questions: InterviewQuestion[];
}

export interface InterviewQuestionAnswer {
  questionId: string;
  question: string;
  answer: string;
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
    // Accept the former single-question shape so an in-flight response from an
    // older server can still be answered after an upgrade.
    const rawQuestions = Array.isArray(args.questions)
      ? args.questions
      : typeof args.question === "string"
        ? [args]
        : [];
    if (rawQuestions.length < 1 || rawQuestions.length > 5) return null;

    const questions = rawQuestions.map((value, questionIndex) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      const rawQuestion = value as Record<string, unknown>;
      const question =
        typeof rawQuestion.question === "string"
          ? rawQuestion.question.trim()
          : "";
      if (!question || !Array.isArray(rawQuestion.options)) return null;
      const options = rawQuestion.options
        .map((optionValue): InterviewQuestionOption | null => {
          if (
            !optionValue ||
            typeof optionValue !== "object" ||
            Array.isArray(optionValue)
          ) {
            return null;
          }
          const option = optionValue as Record<string, unknown>;
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
        .filter((option): option is InterviewQuestionOption => option !== null);
      if (options.length < 2 || options.length > 4) return null;
      return {
        id: `${call.id}-question-${questionIndex + 1}`,
        question,
        options,
      };
    });
    if (questions.some((question) => question === null)) return null;
    return {
      id: call.id,
      questions: questions as InterviewQuestion[],
    };
  }
  return null;
}

/**
 * Keep every submitted answer attached to the exact question the model asked.
 * Tool calls are presentation metadata and are not replayed into the next model
 * request, so the question text must travel with the operator's answer.
 */
export function formatInterviewQuestionAnswers(
  answers: InterviewQuestionAnswer[],
): string {
  return [
    "Answers to the structured interview questions:",
    ...answers.flatMap((item, index) => [
      "",
      `Question ${index + 1} (${item.questionId}): ${item.question}`,
      `Answer: ${item.answer.trim()}`,
    ]),
  ].join("\n");
}

/** Backwards-compatible default for callers that do not expose the setup step. */
export const INTERVIEW_KICKOFF = interviewKickoff("both");

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string")
    throw new Error(`${field} must be text or null.`);
  return value.trim() || null;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} has the wrong shape.`);
  }
  return value as Record<string, unknown>;
}

function serviceTarget(
  value: unknown,
  index: number,
): InterviewServiceCandidate["target"] {
  const target = requiredRecord(value, `Service ${index + 1} target`);
  const kind = target.kind;
  const id = nullableString(target.id, "target id");
  const name = nullableString(target.name, "target name");
  if (!id || !name) throw new Error(`Service ${index + 1} has no hardware target.`);
  if (kind !== "device" && kind !== "vm" && kind !== "container") {
    throw new Error(`Service ${index + 1} has an unsupported hardware target.`);
  }
  return { kind, id, name };
}

function serviceProtocol(value: unknown, index: number): InterviewServiceCandidate["protocol"] {
  if (value === null || value === undefined) return null;
  if (value === "http" || value === "https" || value === "tcp" || value === "udp") return value;
  throw new Error(`Service ${index + 1} has an unsupported protocol.`);
}

function servicePort(value: unknown, index: number): number | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65535
  ) {
    throw new Error(`Service ${index + 1} has an invalid port.`);
  }
  return value;
}

function parseServiceCandidate(item: unknown, index: number): InterviewServiceCandidate {
  const service = requiredRecord(item, `Service ${index + 1}`);
  const name = nullableString(service.name, "service name");
  const evidence = nullableString(service.evidence, "service evidence");
  if (!name || !evidence) {
    throw new Error(`Service ${index + 1} is missing a name, target, or evidence.`);
  }
  return {
    name,
    url: nullableString(service.url, "service URL"),
    port: servicePort(service.port, index),
    protocol: serviceProtocol(service.protocol, index),
    description: nullableString(service.description, "service description"),
    target: serviceTarget(service.target, index),
    evidence,
  };
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
  const record = requiredRecord(value, "The service proposal");
  if (!Array.isArray(record.services)) {
    throw new Error("The service proposal is missing its services list.");
  }
  const services = record.services.map(parseServiceCandidate);
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
