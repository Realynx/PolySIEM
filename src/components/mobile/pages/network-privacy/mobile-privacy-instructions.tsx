"use client";

import { ChevronDown, Waypoints } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CopyButton } from "@/components/ssh/copy-button";
import { useDisclosureOpenRequest } from "@/components/network/use-disclosure-open-request";
import {
  privacySetupDisclosureDomId,
  type VpnSetupField,
  type VpnSetupInstructions,
  type VpnSetupStep,
} from "@/components/network/privacy-router-presentation";

/**
 * One privacy router walkthrough on a phone, collapsed by default — ALWAYS.
 *
 * There is deliberately no `defaultOpen` prop, matching the desktop disclosure
 * after its regression: reference material does not open itself, the Setup tab
 * leads with the one next action, and
 * `privacy-router-setup-instructions.test.ts` pins both surfaces closed.
 *
 * `openRequest` is the same narrow exception the desktop disclosure carries, and
 * it is a request rather than a default: a mounting value opens nothing, only a
 * later change does. See `use-disclosure-open-request.ts`.
 *
 * Every word arrives already written by `privacyRouterInstallInstructions` or
 * `privacyRouterGatewayInstructions` — the same two pure functions the desktop
 * Setup tab renders — so the OPNsense field labels, the ordering gotcha and the
 * bootstrap steps cannot say one thing on a laptop and another on a phone. Only
 * the shape is different: fields stack instead of pairing into a grid, because
 * at 412px a label/value grid wraps into something harder to read than the pair
 * it is meant to align.
 *
 * With no steps it degrades to a plain headline; an empty disclosure to open is
 * worse than no disclosure.
 */
export function MobilePrivacySetupDisclosure({
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
  if (instructions.steps.length === 0) {
    return (
      <div id={domId} className={cn("rounded-xl border bg-card px-3 py-2.5", className)}>
        <VpnSetupHeadline instructions={instructions} />
      </div>
    );
  }
  return (
    <Collapsible id={domId} open={open} onOpenChange={setOpen} className={cn("rounded-xl border bg-card", className)}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex min-h-13 w-full flex-col gap-1.5 px-3 py-2.5 text-left transition-colors active:bg-muted/60"
        >
          <VpnSetupHeadline instructions={instructions} />
          <span className="flex items-center gap-1 self-end text-[11px] font-medium text-muted-foreground">
            {open ? "Hide" : "Show"} {instructions.stepsLabel}
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-2.5 border-t px-3 py-3">
          <ol className="flex flex-col gap-3">
            {instructions.steps.map((step, index) => (
              <VpnSetupStepItem key={step.id} step={step} number={index + 1} />
            ))}
          </ol>
          {instructions.notes.map((note) => (
            <p key={note} className="text-[11px] leading-snug text-muted-foreground">
              {note}
            </p>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function VpnSetupHeadline({ instructions }: { instructions: VpnSetupInstructions }) {
  return (
    <span className="flex min-w-0 items-start gap-2">
      <Waypoints className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-[13px] leading-tight font-medium">{instructions.title}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{instructions.summary}</span>
      </span>
    </span>
  );
}

function VpnSetupStepItem({ step, number }: { step: VpnSetupStep; number: number }) {
  return (
    <li className="flex gap-2.5">
      <span
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[10px] font-medium text-primary"
        aria-hidden="true"
      >
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-tight font-medium">{step.title}</p>
        {step.path && (
          <p className="mt-0.5 font-mono text-[10px] break-words text-muted-foreground">{step.path}</p>
        )}
        {step.detail && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{step.detail}</p>}
        {step.fields.length > 0 && (
          <dl className="mt-2 flex flex-col gap-2 rounded-lg border bg-muted/30 p-2.5">
            {step.fields.map((field) => (
              <VpnSetupFieldRow key={field.label} field={field} />
            ))}
          </dl>
        )}
        {step.footnote && <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{step.footnote}</p>}
      </div>
    </li>
  );
}

/**
 * Stacked, not two columns. `mono` is honoured because a non-mono value is a
 * placeholder — "the clients you want tunnelled" — and a placeholder styled as a
 * literal is a value somebody will type in verbatim. A long mono value is a
 * command or a fingerprint, so it gets a copy control a phone can actually hit.
 */
function VpnSetupFieldRow({ field }: { field: VpnSetupField }) {
  const copyable = field.mono === true && field.value.length > 24;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">{field.label}</dt>
      <dd className="min-w-0">
        <span className="flex items-start gap-1.5">
          <span
            className={cn(
              "min-w-0 flex-1 text-xs leading-snug font-medium break-all",
              field.mono ? "font-mono" : "break-words",
            )}
          >
            {field.value}
          </span>
          {copyable && <CopyButton value={field.value} label={`Copy ${field.label.toLowerCase()}`} />}
        </span>
        {field.note && (
          <span className="mt-0.5 block text-[11px] leading-snug font-normal text-muted-foreground">{field.note}</span>
        )}
      </dd>
    </div>
  );
}
