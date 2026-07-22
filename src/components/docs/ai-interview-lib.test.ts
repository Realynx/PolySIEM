import { describe, expect, it } from "vitest";
import {
  compactInterviewMessages,
  formatInterviewQuestionAnswers,
  interviewFailureMessage,
  interviewKickoff,
  interviewQuestionPrompt,
  parseInterviewServicePlan,
  upsertToolCall,
} from "./ai-interview-lib";

describe("interviewKickoff", () => {
  it("makes the selected outcome and no-SSH boundary explicit", () => {
    expect(interviewKickoff("both").content).toMatch(/documentation page/);
    expect(interviewKickoff("both").content).toMatch(/service inventory/);
    expect(interviewKickoff("services").content).toMatch(
      /Do not assume you can SSH/,
    );
  });
});

describe("interviewQuestionPrompt", () => {
  it("extracts selectable answers from a successful question tool", () => {
    const prompt = interviewQuestionPrompt({
      role: "assistant",
      content: "Updated the service overview.",
      toolCalls: [
        {
          id: "q1",
          kind: "ask_question",
          name: "ask_question",
          args: {
            questions: [
              {
                question: "How is this service backed up?",
                options: [
                  { label: "Snapshots", answer: "Nightly VM snapshots." },
                  {
                    label: "Application backup",
                    answer: "A nightly application-level backup.",
                    description: "Database and uploaded data",
                  },
                ],
              },
            ],
          },
          label: "Ask backup question",
          status: "success",
        },
      ],
    });

    expect(prompt).toEqual({
      id: "q1",
      questions: [
        {
          id: "q1-question-1",
          question: "How is this service backed up?",
          options: [
            { label: "Snapshots", answer: "Nightly VM snapshots." },
            {
              label: "Application backup",
              answer: "A nightly application-level backup.",
              description: "Database and uploaded data",
            },
          ],
        },
      ],
    });
  });

  it("rejects incomplete or failed prompts", () => {
    expect(
      interviewQuestionPrompt({
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "q1",
            kind: "ask_question",
            name: "ask_question",
            args: { question: "Choose", options: [{ label: "One" }] },
            label: "Choose",
            status: "error",
          },
        ],
      }),
    ).toBeNull();
  });

  it("accepts provider-wrapped JSON tool arguments while streaming", () => {
    const prompt = interviewQuestionPrompt({
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "q2",
          kind: "ask_question",
          name: "ask_question",
          args: {
            input: JSON.stringify({
              question: "Who owns this service?",
              options: [
                { label: "Platform team", answer: "The platform team owns it." },
                { label: "Application team", answer: "The application team owns it." },
              ],
            }),
          },
          label: "Ask owner",
          status: "running",
        },
      ],
    });

    expect(prompt?.questions[0]?.question).toBe("Who owns this service?");
    expect(prompt?.questions[0]?.options).toHaveLength(2);
  });

  it("extracts a batch of up to five questions", () => {
    const prompt = interviewQuestionPrompt({
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "batch",
          kind: "ask_question",
          name: "ask_question",
          args: {
            questions: ["Owner", "Backup", "Recovery"].map((question) => ({
              question,
              options: [
                { label: "Known", answer: `${question} is documented.` },
                { label: "Unknown", answer: `${question} is not known yet.` },
              ],
            })),
          },
          label: "Ask questions",
          status: "success",
        },
      ],
    });

    expect(prompt?.questions).toHaveLength(3);
  });

  it("sends custom answers with the question they answer", () => {
    const message = formatInterviewQuestionAnswers([
      {
        questionId: "q1-question-1",
        question: "Where are backups stored?",
        answer: "In an encrypted off-site bucket.",
      },
    ]);

    expect(message).toContain("Where are backups stored?");
    expect(message).toContain("In an encrypted off-site bucket.");
    expect(message).toContain("q1-question-1");
  });
});

describe("compactInterviewMessages", () => {
  const messages = Array.from({ length: 24 }, (_, index) => ({
    role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `turn-${index}`,
  }));

  it("keeps short interviews unchanged", () => {
    const short = messages.slice(0, 8);
    const result = compactInterviewMessages(short);
    expect(result.compacted).toBe(false);
    expect(result.messages).toBe(short);
  });

  it("automatically compacts at 90% while preserving five recent pairs", () => {
    const result = compactInterviewMessages(messages, {
      contextWindowTokens: 100,
      reserveTokens: 90,
    });
    expect(result.compacted).toBe(true);
    expect(result.thresholdTokens).toBe(90);
    expect(result.messages).toHaveLength(12);
    expect(result.messages[0]).toEqual(messages[0]);
    expect(result.messages[1].content).toMatch(/compacted.*context usage/i);
    expect(result.messages.slice(-10)).toEqual(messages.slice(-10));
  });

  it("accepts an interviewer-authored summary before the automatic threshold", () => {
    const result = compactInterviewMessages(messages, {
      force: true,
      reserveTokens: 0,
      summary: "Backups are nightly; restore ownership is unresolved.",
    });
    expect(result.compacted).toBe(true);
    expect(result.messages[1].content).toContain("Backups are nightly");
    expect(result.messages.at(-1)).toEqual(messages.at(-1));
  });
});

describe("parseInterviewServicePlan", () => {
  const valid = JSON.stringify({
    services: [
      {
        name: "Grafana",
        url: "https://grafana.example.test",
        port: 443,
        protocol: "https",
        description: "Metrics dashboards",
        target: { kind: "container", id: "ct-1", name: "monitoring" },
        evidence: "Operator confirmed it",
      },
    ],
    notes: ["Confirm backup owner"],
  });

  it("parses a reviewable service proposal", () => {
    const plan = parseInterviewServicePlan(valid);
    expect(plan.services[0]).toMatchObject({
      name: "Grafana",
      port: 443,
      protocol: "https",
      target: { kind: "container", id: "ct-1" },
    });
    expect(plan.notes).toEqual(["Confirm backup owner"]);
  });

  it("accepts a JSON markdown fence from less obedient models", () => {
    expect(
      parseInterviewServicePlan(`\`\`\`json\n${valid}\n\`\`\``).services,
    ).toHaveLength(1);
  });

  it("rejects missing hardware ids and invalid ports", () => {
    const broken = JSON.stringify({
      services: [
        {
          name: "Grafana",
          port: 70000,
          protocol: "https",
          target: { kind: "container", id: "", name: "monitoring" },
          evidence: "operator answer",
        },
      ],
    });
    expect(() => parseInterviewServicePlan(broken)).toThrow();
  });

  it.each([
    ["numeric strings", "443"],
    ["booleans", true],
    ["single-item arrays", [443]],
  ])("rejects coercible %s as service ports", (_label, port) => {
    const proposal = JSON.stringify({
      services: [
        {
          name: "Grafana",
          port,
          protocol: "https",
          target: { kind: "container", id: "ct-1", name: "monitoring" },
          evidence: "operator answer",
        },
      ],
    });

    expect(() => parseInterviewServicePlan(proposal)).toThrow(
      "Service 1 has an invalid port.",
    );
  });
});

describe("upsertToolCall", () => {
  it("appends a new call", () => {
    const result = upsertToolCall([{ id: "a" }], { id: "b" });
    expect(result).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("replaces an existing call by id (last wins)", () => {
    const result = upsertToolCall([{ id: "a", n: 1 }], { id: "a", n: 2 });
    expect(result).toEqual([{ id: "a", n: 2 }]);
  });
});

describe("interviewFailureMessage", () => {
  it("maps known statuses to friendly copy", () => {
    expect(interviewFailureMessage(404)).toMatch(/isn't available/);
    expect(interviewFailureMessage(401)).toMatch(/session has expired/);
    expect(interviewFailureMessage(403)).toMatch(/permission/);
    expect(interviewFailureMessage(429)).toMatch(/busy/);
    expect(interviewFailureMessage(500)).toMatch(/HTTP 500/);
  });
});
