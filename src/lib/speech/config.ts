/**
 * Single source of truth for the local speech-to-text module.
 *
 * PRIVACY: recorded audio is sent only to the authenticated PolySIEM server,
 * where the bundled model transcribes it in memory. It is never persisted or
 * sent to a third-party service.
 */

/**
 * Whisper model used for dictation. English-only "base" is a good balance of
 * accuracy and speed for short prompts. If it is too slow on a given device,
 * switch this single constant to the smaller `Xenova/whisper-tiny.en`.
 */
export const WHISPER_MODEL_ID = "Xenova/whisper-base.en";

/** Faster, lighter fallback model id (kept here for easy switching). */
export const WHISPER_MODEL_ID_FALLBACK = "Xenova/whisper-tiny.en";

/**
 * Where the model weights are served from.
 *
 * `"local"` serves the ONNX weights + configs from this app's own origin
 * (`/models/...`), which keeps everything within the app's strict
 * `connect-src 'self'` CSP and means nothing is ever requested from a third
 * party. `"remote"` fetches the weights from the Hugging Face CDN instead
 * (requires the CSP to allow `huggingface.co` / `cdn-lfs.huggingface.co`).
 */
export const MODEL_SOURCE: "local" | "remote" = "local";

/** Same-origin path where the model weights live when MODEL_SOURCE === "local". */
export const LOCAL_MODEL_PATH = "/models/";

/** Same-origin path where the onnxruntime-web WASM binaries are served from. */
export const ONNX_WASM_PATH = "/ort/";

/** Whisper expects 16 kHz mono PCM. */
export const TARGET_SAMPLE_RATE = 16000;

/**
 * Cap on clip length handed to the model. Whisper processes audio in 30 s
 * windows; longer clips are truncated and the UI shows a hint.
 */
export const MAX_CLIP_SECONDS = 30;

/** Loading/compiling the bundled model should never leave the UI spinning forever. */
export const MODEL_LOAD_TIMEOUT_MS = 180_000;

/** A 30-second clip should finish well inside this even on a modest CPU. */
export const TRANSCRIPTION_TIMEOUT_MS = 90_000;

/** Cadence for progressive text while the microphone is still recording. */
export const LIVE_TRANSCRIPTION_INTERVAL_MS = 2_500;
