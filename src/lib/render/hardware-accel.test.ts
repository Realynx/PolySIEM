import { beforeEach, describe, expect, it } from "vitest";

import {
  detectHardwareAcceleration,
  resetHardwareAccelerationCache,
  shouldDegradeEffects,
  type HardwareAccelStatus,
} from "@/lib/render/hardware-accel";

function status(over: Partial<HardwareAccelStatus> = {}): HardwareAccelStatus {
  return {
    supported: true,
    accelerated: true,
    renderer: "ANGLE (NVIDIA GeForce RTX 4090)",
    method: "webgpu",
    ...over,
  };
}

describe("shouldDegradeEffects", () => {
  it("degrades only on a conclusive software-rasterizer result", () => {
    expect(
      shouldDegradeEffects(
        status({ accelerated: false, renderer: "SwiftShader", method: "webgl" }),
      ),
    ).toBe(true);
  });

  it("leaves accelerated clients alone", () => {
    expect(shouldDegradeEffects(status())).toBe(false);
  });

  it("stays optimistic when the probe could not run", () => {
    // supported:false means "no answer" (SSR, locked-down browser, timeout) —
    // the opposite of the privacy shield's reading of the same field.
    expect(
      shouldDegradeEffects(
        status({ supported: false, accelerated: false, renderer: null, method: "none" }),
      ),
    ).toBe(false);
    expect(shouldDegradeEffects(null)).toBe(false);
  });
});

describe("detectHardwareAcceleration", () => {
  beforeEach(() => {
    resetHardwareAccelerationCache();
  });

  it("reports an unprobed status outside a browser", async () => {
    // The vitest environment is `node`, so this exercises the SSR guard.
    await expect(detectHardwareAcceleration()).resolves.toEqual({
      supported: false,
      accelerated: false,
      renderer: null,
      method: "none",
    });
  });

  it("probes once and shares the result", () => {
    // WebGL context creation is expensive; three consumers must not mean three
    // probes, which is what the pre-extraction code did.
    expect(detectHardwareAcceleration()).toBe(detectHardwareAcceleration());
  });

  it("re-probes after the cache is reset", () => {
    const first = detectHardwareAcceleration();
    resetHardwareAccelerationCache();
    expect(detectHardwareAcceleration()).not.toBe(first);
  });
});
