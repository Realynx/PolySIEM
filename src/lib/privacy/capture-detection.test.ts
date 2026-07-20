import { describe, expect, it } from "vitest";

import {
  classifyHiddenFrameRate,
  classifyRenderer,
  reduceSignals,
  type CaptureSignal,
} from "@/lib/privacy/capture-detection";
import {
  nextReasons,
  type ShieldReason,
} from "@/components/privacy/use-privacy-shield";

describe("classifyRenderer", () => {
  it("classifies discrete GPU renderer strings as hardware", () => {
    expect(
      classifyRenderer(
        "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)",
      ),
    ).toBe("hardware");
    expect(classifyRenderer("Apple M2")).toBe("hardware");
    expect(
      classifyRenderer("AMD Radeon RX 7900 XTX (radeonsi, navi31, LLVM 17.0.6)"),
    ).toBe("hardware");
    expect(classifyRenderer("Intel(R) Iris(R) Xe Graphics")).toBe("hardware");
  });

  it("classifies SwiftShader as software", () => {
    expect(classifyRenderer("Google SwiftShader")).toBe("software");
    expect(
      classifyRenderer(
        "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
      ),
    ).toBe("software");
  });

  it("classifies llvmpipe and softpipe as software", () => {
    expect(classifyRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(
      "software",
    );
    expect(classifyRenderer("softpipe")).toBe("software");
  });

  it("classifies Microsoft Basic Render Driver as software", () => {
    expect(classifyRenderer("Microsoft Basic Render Driver")).toBe("software");
    expect(
      classifyRenderer(
        "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)",
      ),
    ).toBe("software");
  });

  it("matches software markers case-insensitively", () => {
    expect(classifyRenderer("GOOGLE SWIFTSHADER")).toBe("software");
    expect(classifyRenderer("Mesa OffScreen")).toBe("software");
    expect(classifyRenderer("Generic SOFTWARE rasterizer")).toBe("software");
  });
});

describe("classifyHiddenFrameRate", () => {
  it("flags a hidden tab still rendering at ~60fps over a second", () => {
    expect(classifyHiddenFrameRate(60, 1000)).toBe(true);
  });

  it("accepts the exact 20fps / 700ms boundary", () => {
    expect(classifyHiddenFrameRate(14, 700)).toBe(true);
  });

  it("ignores the throttled trickle browsers allow when hidden", () => {
    expect(classifyHiddenFrameRate(2, 1500)).toBe(false);
    expect(classifyHiddenFrameRate(13, 700)).toBe(false);
  });

  it("ignores high frame rates over too short a window", () => {
    // 18 frames in 300ms is 60fps, but the window is too short to trust —
    // frames queued before the tab hid can still fire.
    expect(classifyHiddenFrameRate(18, 300)).toBe(false);
    expect(classifyHiddenFrameRate(1000, 699)).toBe(false);
  });

  it("treats zero frames as not capturing", () => {
    expect(classifyHiddenFrameRate(0, 1500)).toBe(false);
    expect(classifyHiddenFrameRate(0, 0)).toBe(false);
  });
});

describe("reduceSignals", () => {
  it("adds a signal to an empty set", () => {
    expect(reduceSignals([], "display-media", true)).toEqual([
      "display-media",
    ]);
  });

  it("does not duplicate an already-active signal", () => {
    const current: CaptureSignal[] = ["display-media"];
    const next = reduceSignals(current, "display-media", true);
    expect(next).toEqual(["display-media"]);
    expect(next).toBe(current); // unchanged input returns the same reference
  });

  it("removes an active signal", () => {
    expect(
      reduceSignals(["display-media", "hidden-render"], "display-media", false),
    ).toEqual(["hidden-render"]);
  });

  it("is a no-op when removing an absent signal", () => {
    const current: CaptureSignal[] = ["hidden-render"];
    const next = reduceSignals(current, "display-media", false);
    expect(next).toEqual(["hidden-render"]);
    expect(next).toBe(current);
  });

  it("preserves insertion order", () => {
    let signals: CaptureSignal[] = [];
    signals = reduceSignals(signals, "display-media", true);
    signals = reduceSignals(signals, "hidden-render", true);
    expect(signals).toEqual(["display-media", "hidden-render"]);
    // Re-adding an existing signal must not move it to the end.
    signals = reduceSignals(signals, "display-media", true);
    expect(signals).toEqual(["display-media", "hidden-render"]);
  });
});

describe("nextReasons", () => {
  it("adds a reason to an empty set", () => {
    expect(nextReasons([], "blur", true)).toEqual(["blur"]);
  });

  it("does not duplicate an already-active reason", () => {
    const current: ShieldReason[] = ["printscreen"];
    const next = nextReasons(current, "printscreen", true);
    expect(next).toEqual(["printscreen"]);
    expect(next).toBe(current);
  });

  it("removes only the cleared reason", () => {
    expect(
      nextReasons(["blur", "printscreen", "capture"], "blur", false),
    ).toEqual(["printscreen", "capture"]);
  });

  it("is a no-op when removing an absent reason", () => {
    const current: ShieldReason[] = ["hidden"];
    const next = nextReasons(current, "capture", false);
    expect(next).toEqual(["hidden"]);
    expect(next).toBe(current);
  });

  it("preserves insertion order", () => {
    let reasons: ShieldReason[] = [];
    reasons = nextReasons(reasons, "hidden", true);
    reasons = nextReasons(reasons, "blur", true);
    reasons = nextReasons(reasons, "manual", true);
    expect(reasons).toEqual(["hidden", "blur", "manual"]);
    reasons = nextReasons(reasons, "hidden", true);
    expect(reasons).toEqual(["hidden", "blur", "manual"]);
  });
});
