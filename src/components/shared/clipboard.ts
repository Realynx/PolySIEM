"use client";

function legacyCopyText(value: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;

  const textarea = document.createElement("textarea");
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
    activeElement?.focus();
  }
  return copied;
}

/** Copy text on HTTPS and on self-hosted plain-HTTP dashboards. */
export async function copyText(value: string): Promise<void> {
  let clipboardError: unknown;
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }

  if (legacyCopyText(value)) return;
  throw clipboardError instanceof Error ? clipboardError : new Error("Clipboard access is unavailable");
}
