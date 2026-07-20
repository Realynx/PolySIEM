/**
 * Web Worker that runs Whisper automatic-speech-recognition entirely on-device.
 *
 * PRIVACY: this worker only ever receives already-decoded 16 kHz mono Float32
 * PCM samples and returns text. The audio is transcribed locally via WASM (or
 * WebGPU when available) and is NEVER uploaded anywhere. The only network
 * traffic is fetching the model weights, which are served same-origin from this
 * app (see MODEL_SOURCE in ../../lib/speech/config).
 */

import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressInfo,
} from "@huggingface/transformers";

import {
  LOCAL_MODEL_PATH,
  MODEL_SOURCE,
  ONNX_WASM_PATH,
  WHISPER_MODEL_ID,
} from "../../lib/speech/config";

// ---- Messages exchanged with the hook on the main thread --------------------

export type WorkerInbound =
  | { type: "load" }
  | { type: "transcribe"; id: number; audio: Float32Array };

export type WorkerOutbound =
  | { type: "progress"; progress: number; file?: string; stage: string }
  | { type: "ready" }
  | { type: "result"; id: number; text: string }
  | { type: "error"; id: number | null; message: string };

const post = (message: WorkerOutbound) => {
  (self as unknown as Worker).postMessage(message);
};

// ---- Runtime configuration (runs once, on module import) --------------------

// Serve the onnxruntime-web WASM binaries from our own origin so the runtime
// loads locally instead of reaching out to a CDN.
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = ONNX_WASM_PATH;
  // SharedArrayBuffer multithreading needs cross-origin isolation (COOP/COEP),
  // which this app does not set. Single-threaded avoids that requirement.
  env.backends.onnx.wasm.numThreads = 1;
}

if (MODEL_SOURCE === "local") {
  // Weights are served from this app's origin -> nothing leaves to a third party.
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = LOCAL_MODEL_PATH;
} else {
  // Fetch weights from the Hugging Face CDN (requires a permissive CSP).
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
}

// ---- Lazily-loaded, reused pipeline -----------------------------------------

/** Small quantized (8-bit) weights — good accuracy, small download. */
const WHISPER_DTYPE = "q8";

/**
 * The quantized Whisper decoder packs its token-embedding weights as 4-bit
 * MatMulNBits. This onnxruntime-web build's extended graph-optimization pass
 * (`TransposeDQWeightsForMatMulNBits`) trips over that export ("Missing
 * required scale … embed_tokens") and refuses to create the session. Turning
 * graph optimizations down to "basic" skips that layout pass, so the session
 * builds fine; the runtime cost is negligible for short dictation.
 */
const WHISPER_SESSION_OPTIONS = { graphOptimizationLevel: "basic" } as const;

let asrPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function loadPipeline(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (asrPromise) return asrPromise;

  const progress_callback = (info: ProgressInfo) => {
    // Transformers.js v4 provides aggregate byte progress across every model
    // file. Per-file progress resets for each JSON/ONNX asset and made the UI
    // appear stuck or move backwards, so only surface the aggregate event.
    if (info.status === "progress_total") {
      const progress = Math.round(info.progress ?? 0);
      post({
        type: "progress",
        progress,
        stage: progress >= 100 ? "initializing" : "download",
      });
    } else if (info.status === "ready") {
      post({ type: "progress", progress: 100, stage: "initializing" });
    }
  };

  const build = async (): Promise<AutomaticSpeechRecognitionPipeline> => {
    post({ type: "progress", progress: 0, stage: "starting" });
    // The self-hosted model contains q8 ONNX graphs. WASM is the reliable q8
    // execution provider across supported browsers; attempting WebGPU first can
    // wedge during session creation on some drivers without ever rejecting.
    return (await pipeline("automatic-speech-recognition", WHISPER_MODEL_ID, {
      progress_callback,
      device: "wasm",
      dtype: WHISPER_DTYPE,
      session_options: WHISPER_SESSION_OPTIONS,
    })) as AutomaticSpeechRecognitionPipeline;
  };

  asrPromise = build().then((asr) => {
    post({ type: "ready" });
    return asr;
  });
  // If loading fails, clear the cache so a later attempt can retry.
  asrPromise.catch(() => {
    asrPromise = null;
  });
  return asrPromise;
}

// ---- Message handling -------------------------------------------------------

self.addEventListener("message", async (event: MessageEvent<WorkerInbound>) => {
  const data = event.data;

  if (data.type === "load") {
    // Best-effort warm-up. Swallow failures here: loadPipeline() clears its
    // cache on error, so the follow-up "transcribe" retries the load and
    // surfaces any error against the real request id (see below). This avoids
    // a background preload error clobbering the UI while still recording.
    try {
      await loadPipeline();
    } catch {
      /* surfaced on the next transcribe */
    }
    return;
  }

  if (data.type === "transcribe") {
    try {
      const asr = await loadPipeline();
      const output = await asr(data.audio, {
        // Short-form dictation: single 30 s window, greedy decoding.
        chunk_length_s: 30,
        return_timestamps: false,
      });
      const text = normalizeText(output);
      post({ type: "result", id: data.id, text });
    } catch (err) {
      post({ type: "error", id: data.id, message: errorMessage(err) });
    }
  }
});

function normalizeText(output: unknown): string {
  if (typeof output === "string") return output.trim();
  if (Array.isArray(output)) {
    return output
      .map((chunk) => (chunk as { text?: string })?.text ?? "")
      .join(" ")
      .trim();
  }
  const text = (output as { text?: string })?.text;
  return (text ?? "").trim();
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
