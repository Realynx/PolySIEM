import { describe, expect, it } from "vitest";
import { docInterviewSystemPrompt } from "./prompts";

describe("documentation interview prompt", () => {
  it("allows structured questions without forcing a completion loop", () => {
    const prompt = docInterviewSystemPrompt("document");
    expect(prompt).toMatch(/batch of 1-5 focused questions/);
    expect(prompt).toMatch(/2-4 useful, distinct suggested answers per question/);
    expect(prompt).toMatch(/tool is optional/);
    expect(prompt).toMatch(/Stop asking when.*no material assumptions/i);
    expect(prompt).toMatch(/unresolved assumption.*TODO/i);
  });

  it("requires focused child pages under a stable root", () => {
    const prompt = docInterviewSystemPrompt("both");
    expect(prompt).toMatch(/ONE root page/);
    expect(prompt).toMatch(/write_doc\.parentId/);
    expect(prompt).toMatch(/avoid duplicate roots/);
    expect(prompt).toMatch(/do NOT hand-write or guess child-page Markdown links/);
    expect(prompt).toMatch(/Never repeat or prefix the parent title/);
    expect(prompt).toMatch(/Never invent, guess, or predeclare a documentation link/);
    expect(prompt).toMatch(/write tool rejects nonexistent targets/);
  });

  it("keeps a services-only interview from writing docs", () => {
    expect(docInterviewSystemPrompt("services")).toMatch(
      /service inventory entries only\. Do not call write_doc/,
    );
  });
});
