"use client";

/**
 * Shared speech input for the chat and documentation interview composers.
 *
 * The browser sends progressive snapshots while recording, followed by one
 * authoritative final clip. Audio is mono 16 kHz PCM, remains inside the
 * operator's PolySIEM deployment, and is never persisted.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { downmixToMono, resampleLinear, trimSilence } from "@/lib/speech/audio";
import {
  LIVE_TRANSCRIPTION_INTERVAL_MS,
  MAX_CLIP_SECONDS,
  TARGET_SAMPLE_RATE,
  TRANSCRIPTION_TIMEOUT_MS,
} from "@/lib/speech/config";

export type WhisperStatus = "idle" | "recording" | "transcribing" | "error";

/** Retained for the MicButton API; server transcription has no client model stage. */
export type WhisperLoadingStage = null;

export interface UseWhisperResult {
  status: WhisperStatus;
  progress: number;
  loadingStage: WhisperLoadingStage;
  transcript: string;
  error: string | null;
  hint: string | null;
  isSupported: boolean;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  reset: () => void;
}

export interface UseWhisperOptions {
  onTranscript?: (text: string) => void;
  onInterim?: (text: string) => void;
}

interface DecodedRecording {
  samples: Float32Array;
  truncated: boolean;
}

function detectSupport(): boolean {
  if (typeof window === "undefined") return false;
  const hasMedia =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function";
  const hasRecorder = typeof window.MediaRecorder !== "undefined";
  const hasAudioContext =
    typeof window.AudioContext !== "undefined" ||
    typeof (window as unknown as { webkitAudioContext?: unknown })
      .webkitAudioContext !== "undefined";
  return hasMedia && hasRecorder && hasAudioContext;
}

function apiError(status: number, body: unknown): string {
  const message =
    body && typeof body === "object"
      ? (body as { error?: { message?: unknown } }).error?.message
      : null;
  if (typeof message === "string" && message.trim()) return message;
  if (status === 401)
    return "Your session expired — sign in again to use dictation";
  if (status === 413)
    return `Recordings are limited to ${MAX_CLIP_SECONDS} seconds`;
  return `Speech transcription failed (HTTP ${status})`;
}

async function decodeRecording(blob: Blob): Promise<DecodedRecording> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      channels.push(decoded.getChannelData(channel));
    }

    const mono = downmixToMono(channels);
    let samples = trimSilence(
      resampleLinear(mono, decoded.sampleRate, TARGET_SAMPLE_RATE),
      TARGET_SAMPLE_RATE,
    );
    const maxSamples = MAX_CLIP_SECONDS * TARGET_SAMPLE_RATE;
    const truncated = samples.length > maxSamples;
    if (truncated) samples = samples.slice(0, maxSamples);
    return { samples, truncated };
  } finally {
    void ctx.close();
  }
}

async function requestTranscription(
  samples: Float32Array,
  signal: AbortSignal,
): Promise<string> {
  // Copy the exact sample span so a sliced array cannot upload trailing bytes.
  const payload = new ArrayBuffer(samples.byteLength);
  new Float32Array(payload).set(samples);
  const response = await fetch("/api/ai/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: payload,
    signal,
  });
  const body = (await response.json().catch(() => null)) as {
    data?: { text?: string };
    error?: { message?: string };
  } | null;
  if (!response.ok) throw new Error(apiError(response.status, body));
  return body?.data?.text?.trim() ?? "";
}

export function useWhisper(options: UseWhisperOptions = {}): UseWhisperResult {
  const { onTranscript, onInterim } = options;
  const [status, setStatus] = useState<WhisperStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  const onTranscriptRef = useRef(onTranscript);
  const onInterimRef = useRef(onInterim);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const discardCaptureRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const interimRequestRef = useRef<AbortController | null>(null);
  const interimBusyRef = useRef(false);
  const interimEpochRef = useRef(0);
  const lastInterimAtRef = useRef(0);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onInterimRef.current = onInterim;
  }, [onTranscript, onInterim]);

  useEffect(() => setIsSupported(detectSupport()), []);

  const cleanupCapture = useCallback(() => {
    recorderRef.current = null;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
  }, []);

  const fail = useCallback((message: string) => {
    setError(message);
    setStatus("error");
  }, []);

  const cancelInterim = useCallback(() => {
    interimEpochRef.current += 1;
    interimRequestRef.current?.abort();
    interimRequestRef.current = null;
    interimBusyRef.current = false;
  }, []);

  const processInterim = useCallback(async (blob: Blob, epoch: number) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    try {
      const { samples } = await decodeRecording(blob);
      if (
        epoch !== interimEpochRef.current ||
        samples.length < TARGET_SAMPLE_RATE * 0.5
      ) {
        return;
      }

      controller = new AbortController();
      interimRequestRef.current = controller;
      timeout = setTimeout(() => controller?.abort(), TRANSCRIPTION_TIMEOUT_MS);
      const text = await requestTranscription(samples, controller.signal);
      if (
        text &&
        epoch === interimEpochRef.current &&
        !controller.signal.aborted
      ) {
        setTranscript(text);
        onInterimRef.current?.(text);
      }
    } catch {
      // Progressive previews are best-effort. The final pass surfaces errors.
    } finally {
      if (timeout) clearTimeout(timeout);
      if (interimRequestRef.current === controller) {
        interimRequestRef.current = null;
      }
      if (epoch === interimEpochRef.current) interimBusyRef.current = false;
    }
  }, []);

  const processAndTranscribe = useCallback(
    async (blob: Blob) => {
      try {
        const { samples, truncated } = await decodeRecording(blob);
        if (truncated) {
          setHint(
            `Recording was long — only the first ${MAX_CLIP_SECONDS}s were transcribed.`,
          );
        }
        if (samples.length < TARGET_SAMPLE_RATE * 0.1) {
          setTranscript("");
          setStatus("idle");
          setHint(
            "No speech was detected — try speaking closer to the microphone.",
          );
          onTranscriptRef.current?.("");
          return;
        }

        const controller = new AbortController();
        requestRef.current?.abort();
        requestRef.current = controller;
        const timeout = setTimeout(
          () => controller.abort(),
          TRANSCRIPTION_TIMEOUT_MS,
        );
        setStatus("transcribing");

        try {
          const text = await requestTranscription(samples, controller.signal);
          setTranscript(text);
          setStatus("idle");
          onTranscriptRef.current?.(text);
          if (!text) {
            setHint(
              "No words were recognized — try a slightly longer recording.",
            );
          }
        } catch (requestError) {
          if (controller.signal.aborted) {
            if (requestRef.current === controller) {
              fail(
                "Transcription timed out — click the microphone to try again",
              );
            }
          } else {
            fail(
              requestError instanceof Error
                ? requestError.message
                : "Transcription failed",
            );
          }
        } finally {
          clearTimeout(timeout);
          if (requestRef.current === controller) requestRef.current = null;
        }
      } catch (decodeError) {
        fail(
          decodeError instanceof Error
            ? decodeError.message
            : "Could not process audio",
        );
      }
    },
    [fail],
  );

  const start = useCallback(async () => {
    if (!isSupported) return;
    requestRef.current?.abort();
    requestRef.current = null;
    cancelInterim();
    setError(null);
    setHint(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      chunksRef.current = [];
      discardCaptureRef.current = false;
      lastInterimAtRef.current = Date.now();

      const preferredType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = preferredType
        ? new MediaRecorder(stream, { mimeType: preferredType })
        : new MediaRecorder(stream);
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size === 0) return;
        chunksRef.current.push(event.data);

        const now = Date.now();
        if (
          recorder.state === "recording" &&
          !interimBusyRef.current &&
          now - lastInterimAtRef.current >= LIVE_TRANSCRIPTION_INTERVAL_MS
        ) {
          lastInterimAtRef.current = now;
          interimBusyRef.current = true;
          const snapshot = new Blob([...chunksRef.current], {
            type: recorder.mimeType || "audio/webm",
          });
          const epoch = interimEpochRef.current;
          void processInterim(snapshot, epoch);
        }
      });
      recorder.addEventListener("stop", () => {
        if (discardCaptureRef.current) {
          discardCaptureRef.current = false;
          chunksRef.current = [];
          cleanupCapture();
          return;
        }
        const recorded = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        cleanupCapture();
        void processAndTranscribe(recorded);
      });
      recorderRef.current = recorder;
      recorder.start(250);
      setStatus("recording");
    } catch (captureError) {
      cleanupCapture();
      const name = (captureError as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        fail("Microphone permission denied");
      } else if (name === "NotFoundError") {
        fail("No microphone found");
      } else {
        fail(
          captureError instanceof Error
            ? captureError.message
            : "Could not start recording",
        );
      }
    }
  }, [
    cancelInterim,
    cleanupCapture,
    fail,
    isSupported,
    processAndTranscribe,
    processInterim,
  ]);

  const stop = useCallback(() => {
    cancelInterim();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else cleanupCapture();
  }, [cancelInterim, cleanupCapture]);

  const cancel = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    cancelInterim();
    discardCaptureRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else cleanupCapture();
    setError(null);
    setHint(null);
    setStatus("idle");
  }, [cancelInterim, cleanupCapture]);

  const reset = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    cancelInterim();
    setTranscript("");
    setError(null);
    setHint(null);
    setStatus("idle");
  }, [cancelInterim]);

  useEffect(
    () => () => {
      requestRef.current?.abort();
      cancelInterim();
      try {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          discardCaptureRef.current = true;
          recorderRef.current.stop();
        }
      } catch {
        // Recorder may already have been released by the browser.
      }
      cleanupCapture();
    },
    [cancelInterim, cleanupCapture],
  );

  return {
    status,
    progress: status === "transcribing" ? 50 : 0,
    loadingStage: null,
    transcript,
    error,
    hint,
    isSupported,
    start,
    stop,
    cancel,
    reset,
  };
}
