"use client";

import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { PulseView } from "@/lib/types";
import { TlpBadge } from "@/components/logs/threat-intel/tlp-badge";
import { CopyButton } from "@/components/ssh/copy-button";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileKeyRow, MobileList } from "@/components/mobile/ui/mobile-list";

/**
 * Phone detail surface for one OTX pulse — the desktop PulseSheet's content
 * (meta, tags, ATT&CK ids, indicators, references) adapted to a BottomSheet.
 */
export function MobilePulseSheet({
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

  const meta: { label: string; value: string }[] = [
    { label: "Author", value: pulse.author },
    { label: "Created", value: formatDateTime(pulse.created) },
    { label: "Updated", value: `${formatRelative(pulse.modified)}` },
    ...(pulse.adversary ? [{ label: "Adversary", value: pulse.adversary }] : []),
    ...(pulse.malwareFamilies.length > 0
      ? [{ label: "Malware families", value: pulse.malwareFamilies.join(", ") }]
      : []),
    ...(pulse.targetedCountries.length > 0
      ? [{ label: "Targeted countries", value: pulse.targetedCountries.join(", ") }]
      : []),
  ];

  return (
    <BottomSheet open onOpenChange={onOpenChange} title={pulse.name} hideHeader>
      <div className="space-y-4 pb-2">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <TlpBadge tlp={pulse.tlp} className="text-[0.65rem]" />
            <span className="text-[11px] text-muted-foreground">updated {formatRelative(pulse.modified)}</span>
          </div>
          <h2 className="text-[15px] leading-snug font-semibold">{pulse.name}</h2>
          {pulse.description && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {pulse.description}
            </p>
          )}
        </div>

        <MobileList>
          {meta.map((m) => (
            <MobileKeyRow key={m.label} label={m.label}>
              {m.value}
            </MobileKeyRow>
          ))}
        </MobileList>

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
          <div className="space-y-1.5">
            <p className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              MITRE ATT&amp;CK
            </p>
            <div className="flex flex-wrap gap-1">
              {pulse.attackIds.map((id) => (
                <a
                  key={id}
                  href={`https://attack.mitre.org/techniques/${id.replace(".", "/")}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs active:bg-accent"
                >
                  {id}
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <p className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            Indicators · {pulse.indicatorCount.toLocaleString()}
          </p>
          {pulse.indicators.length === 0 && (
            <p className="text-sm text-muted-foreground">This pulse carries no indicators.</p>
          )}
          {[...byType.entries()].map(([type, values]) => (
            <div key={type} className="space-y-1.5">
              <p className="font-mono text-xs text-muted-foreground">
                {type} · {values.length}
              </p>
              <div className="space-y-1">
                {values.map((value) => (
                  <div
                    key={value}
                    className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5"
                  >
                    <span className="min-w-0 flex-1 font-mono text-xs break-all">{value}</span>
                    <CopyButton value={value} label={`Copy ${value}`} className="size-6 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {truncated > 0 && (
            <p className="text-xs text-muted-foreground">…and {truncated.toLocaleString()} more on OTX.</p>
          )}
        </div>

        {pulse.references.length > 0 && (
          <div className="space-y-1.5">
            <p className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              References
            </p>
            <ul className="space-y-1">
              {pulse.references.map((ref) => (
                <li key={ref}>
                  <a
                    href={ref}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs break-all text-primary active:underline"
                  >
                    {ref}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Button asChild variant="outline" className="w-full">
          <a href={pulse.url} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" />
            View on OTX
          </a>
        </Button>
      </div>
    </BottomSheet>
  );
}
