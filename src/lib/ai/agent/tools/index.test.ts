import { describe, expect, it } from "vitest";
import type { ToolContext } from "@/lib/ai/agent/types";
import { buildToolSet, toolNames } from "./index";

function context(
  role: ToolContext["role"],
  mode: ToolContext["mode"] = "chat",
): ToolContext {
  return {
    role,
    mode,
    secrets: [],
    externalSources: new Set<string>(),
  };
}

const NEW_READ_TOOLS = [
  "discover_elasticsearch_fields",
  "search_elasticsearch",
  "get_lab_overview",
  "get_asset_topology",
  "list_security_tickets",
  "get_security_ticket",
  "get_integration_health",
  "securitytrails_lookup",
] as const;

const WRITE_TOOLS = ["write_doc", "run_workflow", "trigger_sync"] as const;

describe("AI assistant tool registry", () => {
  it("makes the expanded read surface available to normal chat users", () => {
    const names = toolNames(context("USER"));

    expect(names).toEqual(expect.arrayContaining([...NEW_READ_TOOLS]));
    expect(names).not.toEqual(expect.arrayContaining([...WRITE_TOOLS]));
  });

  it("keeps broad state-changing tools admin-only and chat-only", () => {
    expect(toolNames(context("ADMIN", "chat"))).toEqual(
      expect.arrayContaining([...WRITE_TOOLS]),
    );
    const interviewTools = toolNames(context("ADMIN", "doc-interview"));
    expect(interviewTools).toContain("write_doc");
    expect(interviewTools).not.toEqual(
      expect.arrayContaining(["run_workflow", "trigger_sync"]),
    );
    expect(toolNames(context("USER", "doc-interview"))).toContain("write_doc");
  });

  it("offers structured questions only during documentation interviews", () => {
    expect(toolNames(context("ADMIN", "doc-interview"))).toContain(
      "ask_question",
    );
    expect(toolNames(context("USER", "doc-interview"))).toContain(
      "ask_question",
    );
    expect(toolNames(context("ADMIN", "chat"))).not.toContain("ask_question");
  });

  it("accepts batches of one to five structured interview questions", () => {
    const askQuestion = buildToolSet(context("USER", "doc-interview")).find(
      (tool) => tool.name === "ask_question",
    );
    const question = {
      question: "How is this service backed up?",
      options: [
        { label: "Snapshots", answer: "It uses nightly snapshots." },
        { label: "Application backup", answer: "It uses app-level backups." },
      ],
    };

    expect(askQuestion?.schema.safeParse({ questions: [question] }).success).toBe(
      true,
    );
    expect(
      askQuestion?.schema.safeParse({ questions: Array(5).fill(question) }).success,
    ).toBe(true);
    expect(askQuestion?.schema.safeParse({ questions: [] }).success).toBe(false);
    expect(
      askQuestion?.schema.safeParse({ questions: Array(6).fill(question) }).success,
    ).toBe(false);
  });

  it("keeps documentation writes disabled in a locked public demo", () => {
    const previousMode = process.env.POLYSIEM_DEMO_MODE;
    const previousLock = process.env.POLYSIEM_DEMO_LOCKED;
    process.env.POLYSIEM_DEMO_MODE = "true";
    process.env.POLYSIEM_DEMO_LOCKED = "true";
    try {
      const names = toolNames(context("ADMIN", "doc-interview"));
      expect(names).toContain("ask_question");
      expect(names).not.toContain("write_doc");
    } finally {
      if (previousMode === undefined) delete process.env.POLYSIEM_DEMO_MODE;
      else process.env.POLYSIEM_DEMO_MODE = previousMode;
      if (previousLock === undefined) delete process.env.POLYSIEM_DEMO_LOCKED;
      else process.env.POLYSIEM_DEMO_LOCKED = previousLock;
    }
  });

  it("accepts parent ids for hierarchical interview documentation", () => {
    const writeDoc = buildToolSet(context("USER", "doc-interview")).find(
      (tool) => tool.name === "write_doc",
    );
    expect(writeDoc).toBeDefined();
    expect(
      writeDoc?.schema.safeParse({
        title: "Nextcloud Backup & Recovery",
        content: "## Restore",
        parentId: "nextcloud-root-id",
      }).success,
    ).toBe(true);
  });
});
