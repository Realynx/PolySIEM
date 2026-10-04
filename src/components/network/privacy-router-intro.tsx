"use client";

import { Split } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIVACY_ROUTER_INTRO } from "./privacy-router-presentation";

/**
 * What a privacy router is, and what you need before you start.
 *
 * Not behind a disclosure, and not a tooltip. An operator who has just clicked
 * "Add a privacy router" is, at that exact moment, guaranteed to be asking what
 * one is — this is the only moment in the product where that is certain, and
 * an empty state has the room to answer it in full.
 *
 * Every word comes from `privacy-router-presentation`, so the phone's empty
 * state and this one cannot describe the same box differently.
 */
export function PrivacyRouterIntroBlock({ className }: { className?: string }) {
  return (
    <section className={cn("rounded-lg border bg-muted/20 p-4", className)} aria-label="What a privacy router is">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Split className="size-4.5" aria-hidden="true" />
        </div>
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium">{PRIVACY_ROUTER_INTRO.headline}</p>
          {PRIVACY_ROUTER_INTRO.body.map((paragraph) => (
            <p key={paragraph} className="text-sm text-muted-foreground">{paragraph}</p>
          ))}
        </div>
      </div>

      <div className="mt-4 border-t pt-3">
        <p className="text-sm font-medium">{PRIVACY_ROUTER_INTRO.prerequisitesTitle}</p>
        <ul className="mt-1.5 space-y-1.5">
          {PRIVACY_ROUTER_INTRO.prerequisites.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden="true" />
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">{PRIVACY_ROUTER_INTRO.reassurance}</p>
      </div>
    </section>
  );
}
