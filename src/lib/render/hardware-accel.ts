/**
 * GPU capability probe, shared by the privacy shield (which uses it to decide
 * whether frame-timing heuristics mean anything) and by reduced-effects mode
 * (which uses it to drop compositing-heavy CSS on software rasterizers).
 *
 * The two consumers read the result in opposite directions — see
 * `shouldDegradeEffects` — so never branch on `accelerated` alone.
 *
 * Every browser touch is SSR-guarded, and the probe is memoized per page load:
 * WebGL context creation is expensive enough that running it once per consumer
 * would itself cost frames.
 */

export type HardwareAccelStatus = {
  supported: boolean; // could we even probe
  accelerated: boolean; // hardware acceleration available
  renderer: string | null; // e.g. "ANGLE (NVIDIA GeForce ...)"
  method: "webgpu" | "webgl" | "none";
};

const SOFTWARE_RENDERER_MARKERS = [
  "swiftshader",
  "llvmpipe",
  "softpipe",
  "software",
  "microsoft basic render",
  "mesa offscreen",
];

/** A hung GPU-process handshake must not leave the probe unresolved forever. */
const PROBE_TIMEOUT_MS = 2_000;

const UNPROBED: HardwareAccelStatus = {
  supported: false,
  accelerated: false,
  renderer: null,
  method: "none",
};

export function classifyRenderer(renderer: string): "hardware" | "software" {
  const normalized = renderer.toLowerCase();
  return SOFTWARE_RENDERER_MARKERS.some((marker) =>
    normalized.includes(marker),
  )
    ? "software"
    : "hardware";
}

/**
 * Whether to strip expensive effects. Deliberately optimistic: a probe that
 * could not run (`supported: false` — SSR, a locked-down browser, a timeout)
 * leaves the full experience intact. Only a positive software-rasterizer
 * identification degrades the UI, because a wrong `true` here makes the app
 * look flat on hardware that could have rendered it properly.
 */
export function shouldDegradeEffects(
  status: HardwareAccelStatus | null,
): boolean {
  if (!status) return false;
  return status.supported && !status.accelerated;
}

/** Minimal WebGPU surface — the standard DOM lib does not ship these types. */
interface GpuAdapterInfoLike {
  vendor?: string;
  description?: string;
}
interface GpuAdapterLike {
  info?: GpuAdapterInfoLike;
}
interface GpuLike {
  requestAdapter?: () => Promise<GpuAdapterLike | null>;
}

type GlContext = WebGLRenderingContext | WebGL2RenderingContext;

function createGlContext(failIfMajorPerformanceCaveat: boolean): GlContext | null {
  try {
    const canvas = document.createElement("canvas");
    const attributes: WebGLContextAttributes = { failIfMajorPerformanceCaveat };
    return (canvas.getContext("webgl2", attributes) ??
      canvas.getContext("webgl", attributes)) as GlContext | null;
  } catch {
    return null;
  }
}

async function probe(): Promise<HardwareAccelStatus> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return UNPROBED;
  }

  try {
    // WebGPU first: adapters are only handed out for viable devices, so an
    // adapter implies acceleration unless its info names a software rasterizer.
    const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
    if (gpu && typeof gpu.requestAdapter === "function") {
      try {
        const adapter = await gpu.requestAdapter();
        if (adapter) {
          const info = adapter.info;
          const renderer = info?.description || info?.vendor || null;
          const accelerated =
            renderer === null || classifyRenderer(renderer) === "hardware";
          return { supported: true, accelerated, renderer, method: "webgpu" };
        }
      } catch {
        // Fall through to the WebGL probe.
      }
    }

    const relaxed = createGlContext(false);
    if (!relaxed) {
      return { supported: true, accelerated: false, renderer: null, method: "none" };
    }

    let renderer: string | null = null;
    try {
      const debugInfo = relaxed.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        const unmasked = relaxed.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        if (typeof unmasked === "string" && unmasked) renderer = unmasked;
      }
    } catch {
      // Extension may be blocked (e.g. privacy.resistFingerprinting).
    }
    if (renderer === null) {
      try {
        const masked = relaxed.getParameter(relaxed.RENDERER);
        if (typeof masked === "string" && masked) renderer = masked;
      } catch {
        // Leave renderer null; the caveat probe below still decides.
      }
    }

    // A context that only materializes without the performance-caveat flag is
    // being software-rendered even when the renderer string is masked.
    const strict = createGlContext(true);
    const caveatOnly = strict === null;
    const accelerated =
      !caveatOnly &&
      (renderer === null || classifyRenderer(renderer) === "hardware");
    return { supported: true, accelerated, renderer, method: "webgl" };
  } catch {
    return { supported: true, accelerated: false, renderer: null, method: "none" };
  }
}

let cached: Promise<HardwareAccelStatus> | null = null;

/**
 * Probe once per page load. Callers may await this freely — repeat calls share
 * the first probe's promise.
 */
export function detectHardwareAcceleration(): Promise<HardwareAccelStatus> {
  cached ??= Promise.race([
    probe(),
    // Resolving as "unprobed" rather than "software" keeps a slow GPU process
    // from flattening the UI on a machine that is perfectly capable.
    new Promise<HardwareAccelStatus>((resolve) =>
      setTimeout(() => resolve(UNPROBED), PROBE_TIMEOUT_MS),
    ),
  ]);
  return cached;
}

/** Test seam — the memo would otherwise leak across cases. */
export function resetHardwareAccelerationCache(): void {
  cached = null;
}
