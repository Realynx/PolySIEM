import "server-only";

/**
 * Random quotes from the bash.org archive for the About page terminal.
 *
 * bash.org itself is long dead; bash-org-archive.com is the community mirror.
 * It sits behind Cloudflare and rejects requests without a browser-shaped
 * User-Agent, so this is best-effort scraping — every failure path falls back
 * to a bundled quote rather than surfacing an error.
 */

const RANDOM_URL = "https://bash-org-archive.com/?random";
const REQUEST_TIMEOUT_MS = 5_000;
/** Quotes are IRC logs and occasionally enormous; keep the panel sane. */
const MAX_LINES = 12;
const MAX_CHARS = 900;

export interface BashQuote {
  id: number | null;
  text: string;
  rating: number | null;
  url: string | null;
  source: "live" | "offline";
}

/**
 * Shown when the archive is unreachable or quotes are disabled. bash.org #5273
 * is about as safe-for-work as that site ever got.
 */
const OFFLINE_QUOTE: BashQuote = {
  id: 5273,
  text: "<erno> hm. I've lost a machine.. literally _lost_. it responds to ping, it works completely, I just can't figure out where in my apartment it is.",
  rating: null,
  url: "https://bash-org-archive.com/?5273",
  source: "offline",
};

/** Quotes are unmoderated; let operators turn the outbound call off entirely. */
export function bashQuotesEnabled(): boolean {
  const setting = (process.env.POLYSIEM_BASH_QUOTES ?? "").trim().toLowerCase();
  return setting !== "off" && setting !== "false" && setting !== "0";
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(raw: string): string {
  return raw.replace(/&(#x?[0-9a-f]+|\w+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const codePoint = entity[1]?.toLowerCase() === "x"
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Pull the quote body, id and score out of an archive permalink page. */
export function parseBashQuote(html: string): BashQuote | null {
  const body = /<p class="qt">([\s\S]*?)<\/p>/i.exec(html)?.[1];
  if (!body) return null;

  const text = decodeEntities(body.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  if (!text) return null;

  const lines = text.split("\n");
  const truncated =
    lines.length > MAX_LINES
      ? `${lines.slice(0, MAX_LINES).join("\n")}\n…`
      : text;
  const clipped =
    truncated.length > MAX_CHARS ? `${truncated.slice(0, MAX_CHARS)}…` : truncated;

  const rawId = /<a href="\/\?(\d+)"[^>]*title="Permanent link/i.exec(html)?.[1];
  const id = rawId ? Number.parseInt(rawId, 10) : null;
  const rawRating = /\(<font color="[^"]*">(-?\d+)<\/font>\)/i.exec(html)?.[1];

  return {
    id,
    text: clipped,
    rating: rawRating ? Number.parseInt(rawRating, 10) : null,
    url: id ? `https://bash-org-archive.com/?${id}` : null,
    source: "live",
  };
}

/** Fetch a random quote, falling back to the bundled one on any failure. */
export async function getRandomBashQuote(): Promise<BashQuote> {
  if (!bashQuotesEnabled()) return OFFLINE_QUOTE;

  try {
    const response = await fetch(RANDOM_URL, {
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        // Cloudflare answers 403 to anything that looks automated.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) return OFFLINE_QUOTE;
    return parseBashQuote(await response.text()) ?? OFFLINE_QUOTE;
  } catch {
    return OFFLINE_QUOTE;
  }
}
