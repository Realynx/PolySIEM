import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

afterEach(() => vi.unstubAllGlobals());

describe("copyText", () => {
  it("uses the Clipboard API when it is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await copyText("setup command");

    expect(writeText).toHaveBeenCalledWith("setup command");
  });

  it("falls back to a temporary textarea when Clipboard API access is denied", async () => {
    class FakeHTMLElement {
      focus = vi.fn();
    }
    const activeElement = new FakeHTMLElement();
    const textarea = Object.assign(new FakeHTMLElement(), {
      value: "",
      style: {} as Record<string, string>,
      setAttribute: vi.fn(),
      select: vi.fn(),
      remove: vi.fn(),
    });
    const execCommand = vi.fn().mockReturnValue(true);
    const appendChild = vi.fn();
    vi.stubGlobal("HTMLElement", FakeHTMLElement);
    vi.stubGlobal("document", {
      activeElement,
      createElement: vi.fn().mockReturnValue(textarea),
      body: { appendChild },
      execCommand,
    });
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) },
    });

    await copyText("short command");

    expect(textarea.value).toBe("short command");
    expect(textarea.select).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(textarea.remove).toHaveBeenCalled();
    expect(activeElement.focus).toHaveBeenCalled();
  });
});
