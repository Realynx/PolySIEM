import { describe, expect, it } from "vitest";
import { shouldExpandAssistant } from "@/components/chat/chat-layout";

describe("assistant chat layout promotion", () => {
  it("keeps short answers in the side dock", () => {
    expect(shouldExpandAssistant("Everything looks healthy.")).toBe(false);
  });

  it("expands as soon as a second paragraph has content", () => {
    expect(
      shouldExpandAssistant(
        "The firewall is healthy.\n\nI also found one stale DHCP lease.",
      ),
    ).toBe(true);
  });

  it("does not expand on a trailing paragraph break alone", () => {
    expect(shouldExpandAssistant("The first paragraph is still streaming.\n\n"))
      .toBe(false);
  });

  it("expands a provider's unusually long single paragraph", () => {
    expect(shouldExpandAssistant(Array.from({ length: 55 }, () => "word").join(" ")))
      .toBe(true);
    expect(shouldExpandAssistant("x".repeat(320))).toBe(true);
  });
});
