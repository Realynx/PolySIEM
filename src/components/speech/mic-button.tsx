"use client";

/**
 * MicButton — drop-in microphone button for the chat composer.
 *
 * Click to start recording, click again to stop and transcribe through the
 * operator's authenticated PolySIEM server. Audio is processed in memory and is
 * never persisted. The resulting text is delivered via `onTranscript`.
 */

import { useMemo } from "react";
import { Loader2, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useWhisper } from "@/components/speech/use-whisper";

export interface MicButtonProps {
  /** Called with the final transcript when transcription completes. */
  onTranscript: (text: string) => void;
  /** Called with the latest progressive result while recording. */
  onInterim?: (text: string) => void;
  /** Marks the text that existed before this dictation session. */
  onRecordingStart?: () => void;
  /** Clears any pending progressive result when transcription is cancelled. */
  onDictationCancel?: () => void;
  /** Disable the button (e.g. while the assistant is streaming). */
  disabled?: boolean;
  className?: string;
}

export function MicButton({
  onTranscript,
  onInterim,
  onRecordingStart,
  onDictationCancel,
  disabled,
  className,
}: MicButtonProps) {
  const { status, error, hint, isSupported, start, stop, cancel, reset } =
    useWhisper({
      onTranscript,
      onInterim,
    });

  const isRecording = status === "recording";
  const isTranscribing = status === "transcribing";
  const isError = status === "error";
  const isBusy = isTranscribing;

  const { label, tooltip } = useMemo(() => {
    if (isError) {
      return {
        label: error ?? "Speech input error",
        tooltip: error ?? "Something went wrong — click to try again",
      };
    }
    if (isRecording) {
      return {
        label: "Stop recording",
        tooltip: "Listening — speech appears in the message live",
      };
    }
    if (isTranscribing) {
      return {
        label: "Cancel transcription",
        tooltip: "Transcribing… click to cancel",
      };
    }
    return {
      label: "Dictate message",
      tooltip: "Dictate (processed privately by this PolySIEM server)",
    };
  }, [isError, isRecording, isTranscribing, error]);

  // Nothing to render if the browser can't do local STT. `isSupported` is false
  // until after mount, so SSR and first client render agree (both null).
  if (!isSupported) return null;

  const handleClick = () => {
    if (disabled) return;
    if (isBusy) {
      onDictationCancel?.();
      cancel();
      return;
    }
    if (isError) {
      reset();
      onRecordingStart?.();
      void start();
      return;
    }
    if (isRecording) {
      stop();
    } else {
      onRecordingStart?.();
      void start();
    }
  };

  return (
    <TooltipProvider>
      <span data-slot="mic-button" className="relative inline-flex">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant={isRecording ? "destructive" : "ghost"}
              onClick={handleClick}
              disabled={disabled}
              aria-label={label}
              aria-pressed={isRecording}
              data-recording={isRecording || undefined}
              data-status={status}
              className={cn("relative rounded-lg", className)}
            >
              {isRecording ? (
                <span className="relative flex items-center justify-center">
                  {/* Pulsing ring communicates a live recording. */}
                  <span className="absolute inline-flex size-6 animate-ping rounded-full bg-destructive/30" />
                  <Mic className="relative size-4" />
                </span>
              ) : isBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : isError ? (
                <MicOff className="size-4 text-destructive" />
              ) : (
                <Mic className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{tooltip}</TooltipContent>
        </Tooltip>

        {hint && (
          <span
            role="status"
            className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 max-w-[220px] whitespace-normal rounded-md bg-foreground px-2 py-1 text-[11px] text-background shadow-sm"
          >
            {hint}
          </span>
        )}
      </span>
    </TooltipProvider>
  );
}
