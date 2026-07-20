"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { PulseView } from "@/lib/types";
import { TlpBadge } from "./tlp-badge";

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function CopyIndicator({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy indicator"
      className="group inline-flex max-w-full items-center gap-1.5 rounded bg-muted px-1.5 py-0.5 text-left font-mono text-xs break-all hover:bg-accent"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1_200);
      }}
    >
      <span className="min-w-0">{value}</span>
      {copied ? (
        <Check className="size-3 shrink-0 text-success" />
      ) : (
        <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
      )}
    </button>
  );
}

/** Detail drawer for a single pulse: description, indicators and references. */
export function PulseSheet({
  pulse,
  onOpenChange,
}: {
  pulse: PulseView | null;
  onOpenChange: (open: boolean) => void;
}) {
  if (!pulse) return null;

  const byType = new Map<string, string[]>();
  for (const ind of pulse.indicators) {
    const list = byType.get(ind.type) ?? [];
    list.push(ind.indicator);
    byType.set(ind.type, list);
  }
  const truncated = pulse.indicatorCount - pulse.indicators.length;

  const meta: { label: string; value: React.ReactNode }[] = [
    { label: "Author", value: pulse.author },
    { label: "Created", value: formatDateTime(pulse.created) },
    { label: "Updated", value: `${formatDateTime(pulse.modified)} (${formatRelative(pulse.modified)})` },
    ...(pulse.adversary ? [{ label: "Adversary", value: pulse.adversary }] : []),
    ...(pulse.malwareFamilies.length > 0
      ? [{ label: "Malware families", value: pulse.malwareFamilies.join(", ") }]
      : []),
    ...(pulse.targetedCountries.length > 0
      ? [{ label: "Targeted countries", value: pulse.targetedCountries.join(", ") }]
      : []),
  ];

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="space-y-2">
          <div className="flex items-center gap-2 pr-6">
            <TlpBadge tlp={pulse.tlp} className="text-[0.65rem]" />
            <span className="text-xs text-muted-foreground">updated {formatRelative(pulse.modified)}</span>
          </div>
          <SheetTitle className="pr-6 text-left leading-snug">{pulse.name}</SheetTitle>
          {pulse.description && (
            <SheetDescription className="text-left whitespace-pre-wrap">{pulse.description}</SheetDescription>
          )}
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {meta.map((m) => (
              <MetaRow key={m.label} label={m.label}>
                {m.value}
              </MetaRow>
            ))}
          </div>

          {pulse.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {pulse.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[0.65rem] text-muted-foreground">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {pulse.attackIds.length > 0 && (
            <MetaRow label="MITRE ATT&CK">
              <div className="flex flex-wrap gap-1">
                {pulse.attackIds.map((id) => (
                  <a
                    key={id}
                    href={`https://attack.mitre.org/techniques/${id.replace(".", "/")}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-accent"
                  >
                    {id}
                  </a>
                ))}
              </div>
            </MetaRow>
          )}

          <Separator />

          <div className="space-y-3">
            <p className="text-sm font-medium">
              Indicators of compromise{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({pulse.indicatorCount.toLocaleString()})
              </span>
            </p>
            {pulse.indicators.length === 0 && (
              <p className="text-sm text-muted-foreground">This pulse carries no indicators.</p>
            )}
            {[...byType.entries()].map(([type, values]) => (
              <div key={type} className="space-y-1.5">
                <p className="font-mono text-xs text-muted-foreground">
                  {type} · {values.length}
                </p>
                <div className="flex flex-wrap gap-1">
                  {values.map((value) => (
                    <CopyIndicator key={value} value={value} />
                  ))}
                </div>
              </div>
            ))}
            {truncated > 0 && (
              <p className="text-xs text-muted-foreground">
                …and {truncated.toLocaleString()} more on OTX.
              </p>
            )}
          </div>

          {pulse.references.length > 0 && (
            <>
              <Separator />
              <div className="space-y-1.5">
                <p className="text-sm font-medium">References</p>
                <ul className="space-y-1">
                  {pulse.references.map((ref) => (
                    <li key={ref}>
                      <a
                        href={ref}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs break-all text-primary hover:underline"
                      >
                        {ref}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          <Button asChild variant="outline" size="sm" className="w-fit">
            <a href={pulse.url} target="_blank" rel="noreferrer">
              <ExternalLink data-icon="inline-start" />
              View on OTX
            </a>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
