"use client";

import { useCallback, useRef } from "react";

function joinDictation(base: string, speech: string): string {
  const cleanBase = base.trimEnd();
  const cleanSpeech = speech.trim();
  if (!cleanBase) return cleanSpeech;
  if (!cleanSpeech) return cleanBase;
  return `${cleanBase} ${cleanSpeech}`;
}

/**
 * Keeps progressive speech separate from the text that was already composed.
 * Each interim result replaces the prior one; the final result is committed
 * exactly once instead of being appended to its own preview.
 */
export function useDictationText(
  value: string,
  onValueChange: (value: string) => void,
) {
  const valueRef = useRef(value);
  const onValueChangeRef = useRef(onValueChange);
  const baseRef = useRef<string | null>(null);
  valueRef.current = value;
  onValueChangeRef.current = onValueChange;

  const onRecordingStart = useCallback(() => {
    baseRef.current = valueRef.current;
  }, []);

  const onInterim = useCallback((text: string) => {
    const base = baseRef.current ?? valueRef.current;
    baseRef.current = base;
    onValueChangeRef.current(joinDictation(base, text));
  }, []);

  const onTranscript = useCallback((text: string) => {
    const base = baseRef.current ?? valueRef.current;
    onValueChangeRef.current(joinDictation(base, text));
    baseRef.current = null;
  }, []);

  const onDictationCancel = useCallback(() => {
    baseRef.current = null;
  }, []);

  return {
    onRecordingStart,
    onInterim,
    onTranscript,
    onDictationCancel,
  };
}
