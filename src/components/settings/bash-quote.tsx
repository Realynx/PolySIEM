"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { BashQuote } from "@/lib/bash-quotes";

interface ApiResponse {
  data?: BashQuote;
  error?: { message?: string };
}

/**
 * Fetches its quote on mount rather than during the server render so a slow or
 * Cloudflare-blocked archive never delays the About page.
 */
export function BashQuoteBlock() {
  const [quote, setQuote] = useState<BashQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const response = await fetch("/api/about/bash-quote", {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as ApiResponse | null;
      if (!response.ok || !body?.data) throw new Error("no quote");
      setQuote(body.data);
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") setQuote(null);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  return (
    <div>
      <p className="mb-3 flex flex-wrap items-center gap-x-2">
        <span>
          <span className="font-bold text-primary">polysiem@homelab</span>
          <span className="text-muted-foreground">:</span>
          <span className="font-bold text-chart-2">~</span>
          <span className="text-muted-foreground">$</span> curl -s bash.org
          --random
        </span>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
        >
          <RefreshCw className={loading ? "size-3 animate-spin" : "size-3"} />
          {loading ? "fetching…" : "re-roll"}
        </button>
      </p>

      {quote ? (
        <figure className="space-y-2">
          <blockquote className="whitespace-pre-wrap break-words text-card-foreground">
            {quote.text}
          </blockquote>
          <figcaption className="text-muted-foreground">
            {quote.url ? (
              <a
                href={quote.url}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-4 hover:text-primary hover:underline"
              >
                #{quote.id}
              </a>
            ) : (
              "#?????"
            )}
            {quote.rating !== null ? ` (+${quote.rating})` : null}
            {quote.source === "offline"
              ? " — archive unreachable, serving from cache"
              : null}
          </figcaption>
        </figure>
      ) : (
        <p className="text-muted-foreground">
          {loading ? "connecting to bash-org-archive.com…" : "no carrier"}
        </p>
      )}
    </div>
  );
}
