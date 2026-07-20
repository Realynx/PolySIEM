import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { transcribePcm } from "@/lib/ai/transcription";
import { MAX_CLIP_SECONDS, TARGET_SAMPLE_RATE } from "@/lib/speech/config";

export const runtime = "nodejs";

const MAX_PCM_BYTES =
  MAX_CLIP_SECONDS * TARGET_SAMPLE_RATE * Float32Array.BYTES_PER_ELEMENT;

/**
 * Authenticated, same-origin speech transcription. The client sends mono
 * 16 kHz Float32 PCM; the clip is processed in memory and is never persisted.
 */
export const POST = handleApi(async (req: NextRequest) => {
  await requireUser();
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/octet-stream")) {
    throw new ApiError(415, "unsupported_media", "Expected a PCM audio clip");
  }

  const buffer = await req.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new ApiError(400, "empty_audio", "No recorded audio was received");
  }
  if (
    buffer.byteLength > MAX_PCM_BYTES ||
    buffer.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0
  ) {
    throw new ApiError(
      413,
      "audio_too_large",
      `Audio clips are limited to ${MAX_CLIP_SECONDS} seconds`,
    );
  }

  const samples = new Float32Array(buffer);
  for (let index = 0; index < samples.length; index += 1) {
    if (!Number.isFinite(samples[index])) {
      throw new ApiError(400, "invalid_audio", "The recorded audio is invalid");
    }
  }

  return jsonOk({ text: await transcribePcm(samples) });
});
