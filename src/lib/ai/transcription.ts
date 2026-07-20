import "server-only";

import path from "node:path";
import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";
import { WHISPER_MODEL_ID } from "@/lib/speech/config";

const globalSpeech = globalThis as typeof globalThis & {
  __polysiemWhisperPipeline?: Promise<AutomaticSpeechRecognitionPipeline>;
  __polysiemWhisperQueue?: Promise<void>;
};

function modelRoot(): string {
  return `${path.resolve(process.cwd(), "public", "models").replace(/\\/g, "/")}/`;
}

/** Load Whisper once per server process and reuse its ONNX sessions. */
function getPipeline(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (globalSpeech.__polysiemWhisperPipeline) {
    return globalSpeech.__polysiemWhisperPipeline;
  }

  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = modelRoot();

  const pending = pipeline("automatic-speech-recognition", WHISPER_MODEL_ID, {
    device: "cpu",
    dtype: "q8",
    session_options: { graphOptimizationLevel: "basic" },
  }) as Promise<AutomaticSpeechRecognitionPipeline>;

  globalSpeech.__polysiemWhisperPipeline = pending.catch((error) => {
    delete globalSpeech.__polysiemWhisperPipeline;
    throw error;
  });
  return globalSpeech.__polysiemWhisperPipeline;
}

function transcriptText(output: unknown): string {
  if (typeof output === "string") return output.trim();
  if (Array.isArray(output)) {
    return output
      .map((part) =>
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join(" ")
      .trim();
  }
  if (output && typeof output === "object") {
    const text = (output as { text?: unknown }).text;
    if (typeof text === "string") return text.trim();
  }
  return "";
}

/** Transcribe mono 16 kHz PCM. Audio is never persisted. */
export async function transcribePcm(samples: Float32Array): Promise<string> {
  // ONNX inference sessions are shared. Serialize progressive and final calls
  // so a final render can never race an older partial render through Whisper.
  const result = (globalSpeech.__polysiemWhisperQueue ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const asr = await getPipeline();
      const output = await asr(samples, {
        chunk_length_s: 30,
        return_timestamps: false,
      });
      return transcriptText(output);
    });

  globalSpeech.__polysiemWhisperQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
