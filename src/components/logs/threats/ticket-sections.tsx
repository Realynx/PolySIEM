import Link from "next/link";
import { FileSearch, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import type { SecurityTicketDto } from "@/lib/types";
import { EvidenceRow } from "./evidence-row";
import { TicketIpIndicator } from "./ticket-ip-indicator";
import type { TicketRefGroup } from "./use-ticket-details";

export function SuggestedResponse({ suggestions }: { suggestions: string | null }) {
  if (!suggestions) return null;
  return <section className="space-y-2"><h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase"><Lightbulb className="size-3.5" aria-hidden />Suggested response</h3><div className="rounded-xl bg-info/5 p-4 ring-1 ring-info/25"><p className="text-sm leading-relaxed whitespace-pre-wrap">{suggestions}</p></div></section>;
}

export function TicketIndicators({ groups, compact = false }: { groups: TicketRefGroup[]; compact?: boolean }) {
  if (groups.length === 0) return null;
  return <section className="space-y-2"><h3 className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Indicators</h3><div className="space-y-2">{groups.map((group) => <div key={group.label} className="flex flex-wrap items-baseline gap-1.5"><span className={compact ? "w-full shrink-0 text-[11px] text-muted-foreground" : "w-28 shrink-0 text-xs text-muted-foreground"}>{group.label}</span>{group.values.map((value) => {
    if (group.kind === "ip") return <TicketIpIndicator key={value} value={value} compact={compact} />;
    if (group.kind === "host") return <Badge key={value} variant="secondary" className="max-w-full font-mono text-xs" asChild><Link href={`/security/research?subject=${encodeURIComponent(value)}`} title={`Research ${value}`}><span className="truncate">{value}</span><FileSearch className="size-3 shrink-0" /></Link></Badge>;
    return <Badge key={value} variant="secondary" className="max-w-full font-mono text-xs"><span className="truncate">{value}</span></Badge>;
  })}</div>)}</div></section>;
}

export function TicketEvidence({ ticket, compact = false }: { ticket: SecurityTicketDto; compact?: boolean }) {
  if (!ticket.evidence || ticket.evidence.samples.length === 0) return null;
  return <section className="space-y-2"><h3 className="font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Evidence{ticket.evidence.timeRange && <span className="ml-2 font-sans font-normal tracking-normal normal-case">{formatDateTime(ticket.evidence.timeRange.from)} — {formatDateTime(ticket.evidence.timeRange.to)}</span>}</h3><div className={compact ? "divide-y rounded-md border" : "divide-y overflow-hidden rounded-xl ring-1 ring-foreground/10"}>{ticket.evidence.samples.map((sample, index) => <EvidenceRow key={index} sample={sample} scope={ticket.evidence?.scope} />)}</div></section>;
}
