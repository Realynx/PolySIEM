"use client";

import { useMemo, useState } from "react";
import { Braces, ChevronDown, Copy } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type { TicketEvidenceSample } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatEvidenceSample } from "./evidence-format";

export function EvidenceRow({
  sample,
  scope,
}: {
  sample: TicketEvidenceSample;
  scope?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const event = useMemo(() => formatEvidenceSample(sample, scope), [sample, scope]);
  const hasDetails = event.sections.length > 0 || event.decodedRaw !== null;
  const json = JSON.stringify(event.decodedRaw ?? sample.raw ?? sample, null, 2);

  return (
    <div>
      <button
        type="button"
        onClick={() => hasDetails && setExpanded((value) => !value)}
        aria-expanded={expanded}
        className={cn(
          "w-full space-y-1.5 px-3 py-2.5 text-left",
          hasDetails && "cursor-pointer hover:bg-muted/40",
        )}
      >
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium">{event.kind}</span>
          <span aria-hidden>·</span>
          <span className="font-mono whitespace-nowrap">
            {formatDateTime(sample.timestamp)}
          </span>
          {sample.index && (
            <span className="min-w-0 truncate font-mono" title={sample.index}>
              {sample.index}
            </span>
          )}
          {hasDetails && (
            <ChevronDown
              className={cn(
                "ml-auto size-3.5 shrink-0 transition-transform",
                expanded && "rotate-180",
              )}
              aria-hidden
            />
          )}
        </div>
        <p className="break-words text-xs font-medium leading-relaxed">
          {event.title}
        </p>
        {(event.route || event.badges.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {event.route && (
              <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {event.route}
              </code>
            )}
            {event.badges.map((badge) => (
              <Badge
                key={badge}
                variant="outline"
                className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground"
              >
                {badge}
              </Badge>
            ))}
          </div>
        )}
      </button>

      {expanded && (
        <div className="space-y-3 border-t bg-muted/20 px-3 py-3">
          {event.truncated && (
            <p className="text-[11px] text-muted-foreground">
              This captured event was truncated. Showing the structured fields
              that could be recovered.
            </p>
          )}

          {event.sections.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {event.sections.map((section) => (
                <section key={section.title} className="rounded-md border bg-background/70 p-2.5">
                  <h4 className="mb-2 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    {section.title}
                  </h4>
                  <dl className="space-y-1.5">
                    {section.fields.map((field) => (
                      <div
                        key={`${field.label}:${field.value}`}
                        className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 text-xs"
                      >
                        <dt className="text-muted-foreground">{field.label}</dt>
                        <dd
                          className={cn(
                            "min-w-0 break-words",
                            field.mono && "font-mono text-[11px]",
                          )}
                        >
                          {field.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          )}

          <details className="rounded-md border bg-background/70">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground">
              <Braces className="size-3.5" aria-hidden />
              Raw event fields
            </summary>
            <div className="space-y-2 border-t p-2.5">
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(json);
                      toast.success("Evidence copied as JSON");
                    } catch {
                      toast.error("Could not access the clipboard");
                    }
                  }}
                >
                  <Copy data-icon="inline-start" />
                  Copy JSON
                </Button>
              </div>
              <pre className="max-h-72 overflow-auto rounded-md border bg-background p-3 font-mono text-xs leading-relaxed">
                {json}
              </pre>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
