/**
 * Normalize common Markdown-style documentation links to PolySIEM's flat slug
 * route. The page hierarchy lives in parentId, not nested URL segments.
 */
export interface DocLinkTarget {
  slugOrId: string;
  suffix: string;
}

function isInternalDocPath(path: string): boolean {
  const hasDocPrefix = ["/docs/", "docs/", "./", "../"].some((prefix) => path.startsWith(prefix));
  return hasDocPrefix || /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*(?:\.md)?$/i.test(path);
}

/** Return the referenced PolySIEM doc key, or null for non-doc links. */
export function docLinkTarget(href: string | undefined): DocLinkTarget | null {
  if (!href || href.startsWith("#")) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return null;

  const match = /^([^?#]*)([?#].*)?$/.exec(href);
  const path = match?.[1] ?? href;
  const suffix = match?.[2] ?? "";
  const normalized = path.replace(/\\/g, "/");
  if (!isInternalDocPath(normalized)) return null;

  const slug = normalized
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.md$/i, "");
  if (!slug || slug === "edit" || slug === "new") return null;
  return { slugOrId: slug, suffix };
}

export function normalizeDocHref(href: string | undefined): string | undefined {
  const target = docLinkTarget(href);
  return target ? `/docs/${target.slugOrId}${target.suffix}` : href;
}

export interface CanonicalDocLinks {
  content: string;
  missing: string[];
}

/**
 * Resolve internal inline/reference Markdown links against persisted docs and
 * rewrite them to canonical slugs. Missing targets are reported to the caller
 * so a write can be rejected instead of saving a broken link.
 */
export async function canonicalizeMarkdownDocLinks(
  content: string,
  resolve: (slugOrId: string) => Promise<{ slug: string } | null>,
): Promise<CanonicalDocLinks> {
  const patterns = [
    /(\]\(\s*)(<?[^)\s>]+>?)/g,
    /(^\s*\[[^\]]+\]:\s*)(<?[^\s>]+>?)/gm,
  ];
  const references: Array<{ start: number; end: number; href: string }> = [];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const raw = match[2];
      const start = match.index + match[1].length;
      references.push({
        start,
        end: start + raw.length,
        href: raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw,
      });
    }
  }
  references.sort((a, b) => a.start - b.start);

  const cache = new Map<string, { slug: string } | null>();
  const missing = new Set<string>();
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  for (const reference of references) {
    const target = docLinkTarget(reference.href);
    if (!target) continue;
    let resolved = cache.get(target.slugOrId);
    if (resolved === undefined) {
      resolved = await resolve(target.slugOrId);
      cache.set(target.slugOrId, resolved);
    }
    if (!resolved) {
      missing.add(reference.href);
      continue;
    }
    replacements.push({
      start: reference.start,
      end: reference.end,
      value: `/docs/${resolved.slug}${target.suffix}`,
    });
  }

  let rewritten = content;
  for (const replacement of replacements.reverse()) {
    rewritten =
      rewritten.slice(0, replacement.start) +
      replacement.value +
      rewritten.slice(replacement.end);
  }
  return { content: rewritten, missing: [...missing] };
}
