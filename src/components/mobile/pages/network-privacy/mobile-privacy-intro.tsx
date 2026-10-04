"use client";

import { Split } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIVACY_ROUTER_INTRO } from "@/components/network/privacy-router-presentation";

/**
 * What a privacy router is, on a phone.
 *
 * Same words as the desktop block, from the same constant, because the answer
 * to "what is this" cannot be one thing on a laptop and another on a phone.
 * What the phone chooses is only the shape: a card, one column, no icon column
 * competing with the text for a 412px width.
 */
export function MobilePrivacyIntro({ className }: { className?: string }) {
  return (
    <section
      className={cn("rounded-xl border bg-card px-3.5 py-3", className)}
      aria-label="What a privacy router is"
    >
      <p className="flex items-start gap-2 text-[13px] font-medium">
        <Split className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0">{PRIVACY_ROUTER_INTRO.headline}</span>
      </p>
      {PRIVACY_ROUTER_INTRO.body.map((paragraph) => (
        <p key={paragraph} className="mt-2 text-xs leading-snug text-muted-foreground">{paragraph}</p>
      ))}

      <div className="mt-3 border-t pt-2.5">
        <p className="text-[13px] font-medium">{PRIVACY_ROUTER_INTRO.prerequisitesTitle}</p>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {PRIVACY_ROUTER_INTRO.prerequisites.map((item) => (
            <li key={item} className="flex items-start gap-2 text-xs leading-snug text-muted-foreground">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/50" aria-hidden="true" />
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{PRIVACY_ROUTER_INTRO.reassurance}</p>
      </div>
    </section>
  );
}
