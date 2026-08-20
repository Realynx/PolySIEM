"use client";

import { Fragment, useState } from "react";
import { ChevronDown, Waypoints } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  connectorSetupInstructions,
  type ConnectorDto,
  type ConnectorRouteRule,
  type ConnectorSetupField,
  type ConnectorSetupInstructions,
  type ConnectorSetupStep,
} from "./edge-networks-types";

/**
 * What the operator still has to do on the far side of a hand-configured
 * connector, collapsed by default.
 *
 * Finishing the path is expected setup, not a failure, so this is styled as
 * information: the headline alone is enough for someone who already knows, and
 * the steps behind it carry this rule's real protocol, ports, and addresses.
 * Every word comes from `connectorSetupInstructions` so mobile shows the same.
 */
export function ConnectorSetupDisclosure({
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
  return <ConnectorSetupPanel instructions={instructions} className={className} />;
}

function ConnectorSetupPanel({
  instructions,
  className,
}: {
  instructions: ConnectorSetupInstructions;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const headline = <SetupHeadline instructions={instructions} />;
  // A kind PolySIEM has no navigation for keeps exactly the sentence it had
  // before the steps existed — no empty disclosure to open.
  if (instructions.steps.length === 0) {
    return <div className={cn("rounded-lg border bg-muted/20 p-3", className)}>{headline}</div>;
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("rounded-lg border bg-muted/20", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-3">
        {headline}
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="shrink-0">
            {open ? "Hide" : "Show"} {instructions.stepsLabel}
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="space-y-3 border-t p-3">
          {instructions.prerequisite && <SetupPrerequisite step={instructions.prerequisite} />}
          <ol className="space-y-3">
            {instructions.steps.map((step, index) => (
              <SetupStepItem key={step.id} step={step} number={index + 1} />
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

function SetupHeadline({ instructions }: { instructions: ConnectorSetupInstructions }) {
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

/** Stated before the steps because an unassigned instance makes them unselectable. */
function SetupPrerequisite({ step }: { step: ConnectorSetupStep }) {
  return (
    <div className="rounded-md border border-dashed p-2.5">
      <p className="text-xs font-medium">Before you start — {step.title}</p>
      {step.path && <SetupPath path={step.path} />}
      {step.detail && <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>}
    </div>
  );
}

function SetupStepItem({ step, number }: { step: ConnectorSetupStep; number: number }) {
  return (
    <li className="flex gap-2.5">
      <span
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.6875rem] font-medium text-primary"
        aria-hidden="true"
      >
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {step.title}
          {step.conditional && <span className="ml-1.5 text-xs font-normal text-muted-foreground">— often not needed</span>}
        </p>
        {step.path && <SetupPath path={step.path} />}
        {step.detail && <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>}
        {step.fields.length > 0 && (
          <dl className="mt-2 grid gap-x-3 gap-y-1.5 rounded-md border bg-background p-2.5 sm:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)]">
            {step.fields.map((field) => (
              <SetupFieldRow key={field.label} field={field} />
            ))}
          </dl>
        )}
        {step.footnote && <p className="mt-2 text-xs text-muted-foreground">{step.footnote}</p>}
      </div>
    </li>
  );
}

/** The navigation trail, in the far side's own words. */
function SetupPath({ path }: { path: string }) {
  return <p className="mt-0.5 font-mono text-[0.6875rem] break-words text-muted-foreground">{path}</p>;
}

function SetupFieldRow({ field }: { field: ConnectorSetupField }) {
  return (
    <Fragment>
      <dt className="text-xs text-muted-foreground">{field.label}</dt>
      <dd className="min-w-0 text-xs">
        <span className={cn("font-medium break-all", field.mono && "font-mono")}>{field.value}</span>
        {field.note && (
          <span className="mt-0.5 block text-[0.6875rem] font-normal text-muted-foreground">{field.note}</span>
        )}
      </dd>
    </Fragment>
  );
}
