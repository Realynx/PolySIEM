"use client";

import { Fragment } from "react";
import { ChevronDown, Waypoints } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CopyButton } from "@/components/ssh/copy-button";
import { useDisclosureOpenRequest } from "./use-disclosure-open-request";
import {
  privacySetupDisclosureDomId,
  type VpnSetupField,
  type VpnSetupInstructions,
  type VpnSetupStep,
} from "./privacy-router-presentation";

/**
 * One privacy router walkthrough, collapsed by default — ALWAYS.
 *
 * Same shape as `connector-setup-instructions.tsx`, for the same reason: this is
 * expected setup rather than a failure, so it is styled as information, and
 * every word arrives already written by a pure function in
 * `privacy-router-presentation.ts` — mobile renders the identical copy from the
 * identical call.
 *
 * There is deliberately no `defaultOpen` prop. It had one, the Setup tab passed
 * `!provisionedAt`, and the result was a screen that opened with two expanded
 * walkthroughs and no visible focal point: "I really couldn't get my bearings on
 * the page as a user where I was supposed to look." Reference material does not
 * get to open itself; the tab leads with the one next action instead, and
 * `privacy-router-setup-instructions.test.ts` pins this closed.
 *
 * `openRequest` is the one narrow exception, and it is a REQUEST rather than a
 * default: a mounting value never opens anything, only a subsequent change does,
 * so the only thing that can open a walkthrough is an operator clicking the
 * next-step card's button while looking at it. See
 * {@link useDisclosureOpenRequest}, which is where that distinction is enforced.
 *
 * With no steps it degrades to a plain headline. An empty disclosure to open is
 * worse than no disclosure.
 */
export function VpnSetupDisclosure({
  instructions,
  className,
  openRequest,
}: {
  instructions: VpnSetupInstructions;
  className?: string;
  /** Increment to ask this disclosure to open. Never opens it on mount. */
  openRequest?: number;
}) {
  const [open, setOpen] = useDisclosureOpenRequest(openRequest);
  const domId = privacySetupDisclosureDomId(instructions.id);
  const headline = <VpnSetupHeadline instructions={instructions} />;
  if (instructions.steps.length === 0) {
    return <div id={domId} className={cn("rounded-lg border bg-muted/20 p-3", className)}>{headline}</div>;
  }
  return (
    <Collapsible id={domId} open={open} onOpenChange={setOpen} className={cn("rounded-lg border bg-muted/20", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-3">
        {headline}
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="shrink-0">
            {open ? "Hide" : "Show"} {instructions.stepsLabel}
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="space-y-3 border-t p-3">
          <ol className="space-y-3">
            {instructions.steps.map((step, index) => (
              <VpnSetupStepItem key={step.id} step={step} number={index + 1} />
            ))}
          </ol>
          {instructions.notes.map((note) => (
            <p key={note} className="text-xs text-muted-foreground">{note}</p>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function VpnSetupHeadline({ instructions }: { instructions: VpnSetupInstructions }) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-2">
      <Waypoints className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium">{instructions.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{instructions.summary}</p>
      </div>
    </div>
  );
}

function VpnSetupStepItem({ step, number }: { step: VpnSetupStep; number: number }) {
  return (
    <li className="flex gap-2.5">
      <span
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.6875rem] font-medium text-primary"
        aria-hidden="true"
      >
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{step.title}</p>
        {step.path && (
          <p className="mt-0.5 font-mono text-[0.6875rem] break-words text-muted-foreground">{step.path}</p>
        )}
        {step.detail && <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>}
        {step.fields.length > 0 && (
          <dl className="mt-2 grid gap-x-3 gap-y-1.5 rounded-md border bg-background p-2.5 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
            {step.fields.map((field) => (
              <VpnSetupFieldRow key={field.label} field={field} />
            ))}
          </dl>
        )}
        {step.footnote && <p className="mt-2 text-xs text-muted-foreground">{step.footnote}</p>}
      </div>
    </li>
  );
}

/** A long mono value is a command or a fingerprint, so it gets a copy control. */
function VpnSetupFieldRow({ field }: { field: VpnSetupField }) {
  const copyable = field.mono === true && field.value.length > 24;
  return (
    <Fragment>
      <dt className="text-xs text-muted-foreground">{field.label}</dt>
      <dd className="min-w-0 text-xs">
        <span className="flex items-start gap-1.5">
          <span className={cn("min-w-0 flex-1 font-medium break-all", field.mono && "font-mono")}>{field.value}</span>
          {copyable && <CopyButton value={field.value} label={`Copy ${field.label.toLowerCase()}`} />}
        </span>
        {field.note && (
          <span className="mt-0.5 block text-[0.6875rem] font-normal text-muted-foreground">{field.note}</span>
        )}
      </dd>
    </Fragment>
  );
}
