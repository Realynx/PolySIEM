"use client";

import Link from "next/link";
import { Cloud, Plus, Server, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RelayPathDiagram } from "./edge-relay-path";
import {
  RELAY_EXPLAINER,
  RELAY_EXPLAINER_DETAIL,
  RELAY_GETTING_STARTED,
  RELAY_PATH_TEMPLATE,
} from "./edge-relay-presentation";

export const ADD_RELAY_SERVER_HREF = "/settings/integrations?add=EDGE_NAT_SERVER";

/**
 * The empty page, written as the first step of setup rather than as a dead end:
 * what a relay server is, the path traffic takes, the four steps ahead, and the
 * button that starts the first one. `withAlternatives` adds the Tailscale and
 * Cloudflare doors for a page that has nothing at all yet.
 */
export function RelayGetStarted({ isAdmin, withAlternatives = false }: { isAdmin: boolean; withAlternatives?: boolean }) {
  return (
    <section className="space-y-5 rounded-xl border bg-card p-5 sm:p-6" aria-labelledby="relay-get-started-heading">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Server className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 space-y-1">
          <h2 id="relay-get-started-heading" className="text-lg font-semibold">Reach home services through a relay server</h2>
          <p className="text-sm text-muted-foreground">{RELAY_EXPLAINER}</p>
        </div>
      </div>

      <RelayPathDiagram hops={RELAY_PATH_TEMPLATE} />
      <p className="text-sm text-muted-foreground">{RELAY_EXPLAINER_DETAIL}</p>

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {RELAY_GETTING_STARTED.map((step, index) => (
          <li key={step.title} className="flex gap-2.5 rounded-lg border bg-muted/20 p-3">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.6875rem] font-medium text-primary">
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{step.title}</span>
              <span className="block text-xs text-muted-foreground">{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>

      {isAdmin ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild>
            <Link href={ADD_RELAY_SERVER_HREF}><Plus className="size-4" /> Add relay server</Link>
          </Button>
          {withAlternatives && (
            <>
              <Button asChild variant="outline">
                <Link href="/settings/integrations?add=TAILSCALE"><Share2 className="size-4" /> Connect Tailscale</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/settings/integrations?add=CLOUDFLARE"><Cloud className="size-4" /> Connect Cloudflare</Link>
              </Button>
            </>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Ask an administrator to add a relay server.</p>
      )}
    </section>
  );
}
