const LONG_PARAGRAPH_WORDS = 55;
const LONG_PARAGRAPH_CHARACTERS = 320;

/**
 * Promote the side dock once an answer needs a proper reading surface. A
 * visible second paragraph is the strongest signal; word/character fallbacks
 * cover providers that stream one very long paragraph without blank lines.
 */
export function shouldExpandAssistant(content: string): boolean {
  const normalized = content.trim();
  if (!normalized) return false;

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length > 1) return true;

  const words = normalized.split(/\s+/).filter(Boolean).length;
  return (
    words >= LONG_PARAGRAPH_WORDS ||
    normalized.length >= LONG_PARAGRAPH_CHARACTERS
  );
}
