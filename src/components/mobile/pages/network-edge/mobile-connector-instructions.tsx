"use client";

import { useState } from "react";
import { ChevronDown, Waypoints } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  connectorSetupInstructions,
  type ConnectorDto,
  type ConnectorRouteRule,
  type ConnectorSetupField,
  type ConnectorSetupInstructions,
  type ConnectorSetupStep,
} from "@/components/network/edge-networks-types";

/**
 * What the operator still has to do on the far side of a hand-configured
 * connector, on a phone, collapsed by default.
 *
 * PolySIEM stops at the tunnel for a manual peer and always has — finishing the
 * path is expected setup, not a fault — so this is neutral: no amber, no ⚠, and
 * the headline alone is enough for someone who already knows. The steps behind
 * it carry this rule's real protocol, ports and addresses.
 *
 * Every word comes from `connectorSetupInstructions` in the shared layer, which
 * also produces the one-line `connectorRouteWarning`, so the phone, the desktop
 * dialog and the summary sentence can never contradict each other.
 */
export function MobileConnectorSetupDisclosure({
  connector,
  rule,
  integrationId,
  className,
}: {
  connector: ConnectorDto;
  /** The rule being published, when there is one — its values fill the steps. */
  rule?: ConnectorRouteRule;
  /** The edge publishing it; its link supplies the tunnel address. */
  integrationId?: string | null;
  className?: string;
}) {
  const instructions = connectorSetupInstructions(connector, rule, integrationId);
  if (!instructions) return null;
  return <SetupPanel instructions={instructions} className={className} />;
}

function SetupPanel({ instructions, className }: { instructions: ConnectorSetupInstructions; className?: string }) {
  const [open, setOpen] = useState(false);
  // A kind PolySIEM has no navigation for keeps exactly the sentence it had
  // before the steps existed — no empty disclosure to open.
  if (instructions.steps.length === 0) {
    return (
      <div className={cn("rounded-xl border bg-card px-3 py-2.5", className)}>
        <SetupHeadline instructions={instructions} />
      </div>
    );
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("rounded-xl border bg-card", className)}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex min-h-13 w-full flex-col gap-1.5 px-3 py-2.5 text-left transition-colors active:bg-muted/60"
        >
          <SetupHeadline instructions={instructions} />
          <span className="flex items-center gap-1 self-end text-[11px] font-medium text-muted-foreground">
            {open ? "Hide" : "Show"} {instructions.stepsLabel}
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-2.5 border-t px-3 py-3">
          {instructions.prerequisite && <SetupPrerequisite step={instructions.prerequisite} />}
          <ol className="flex flex-col gap-3">
            {instructions.steps.map((step, index) => (
              <SetupStepItem key={step.id} step={step} number={index + 1} />
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

function SetupHeadline({ instructions }: { instructions: ConnectorSetupInstructions }) {
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

/** Stated before the steps because an unassigned instance makes them unselectable. */
function SetupPrerequisite({ step }: { step: ConnectorSetupStep }) {
  return (
    <div className="rounded-lg border border-dashed p-2.5">
      <p className="text-[11px] font-medium">Before you start — {step.title}</p>
      <SetupPath path={step.path} />
      {step.detail && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{step.detail}</p>}
    </div>
  );
}

function SetupStepItem({ step, number }: { step: ConnectorSetupStep; number: number }) {
  return (
    <li className="flex gap-2.5">
      <span
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[10px] font-medium text-primary"
        aria-hidden="true"
      >
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-tight font-medium">
          {step.title}
          {step.conditional && (
            <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">— often not needed</span>
          )}
        </p>
        <SetupPath path={step.path} />
        {step.detail && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{step.detail}</p>}
        {step.fields.length > 0 && (
          <dl className="mt-2 flex flex-col gap-2 rounded-lg border bg-muted/30 p-2.5">
            {step.fields.map((field) => (
              <SetupFieldRow key={field.label} field={field} />
            ))}
          </dl>
        )}
        {step.footnote && <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{step.footnote}</p>}
      </div>
    </li>
  );
}

/** The navigation trail, in the far side's own words. */
function SetupPath({ path }: { path: string | null }) {
  if (!path) return null;
  return <p className="mt-0.5 font-mono text-[10px] break-words text-muted-foreground">{path}</p>;
}

/**
 * Stacked, not two columns: at 412px a label/value grid wraps into something
 * harder to read than the pair it is meant to align. `mono` is honoured because
 * a non-mono value is a placeholder, and a placeholder styled as a literal is a
 * value an operator will type in verbatim.
 */
function SetupFieldRow({ field }: { field: ConnectorSetupField }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">{field.label}</dt>
      <dd className="min-w-0">
        <span className={cn("block text-xs leading-snug font-medium break-words", field.mono && "font-mono")}>
          {field.value}
        </span>
        {field.note && (
          <span className="mt-0.5 block text-[11px] leading-snug font-normal text-muted-foreground">{field.note}</span>
        )}
      </dd>
    </div>
  );
}
