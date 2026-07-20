"use client";

import { useState } from "react";
import {
  AlertCircle,
  Box,
  Check,
  FileText,
  Fingerprint,
  Globe,
  Landmark,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  Network,
  Play,
  RefreshCw,
  ScrollText,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentToolCall, AgentToolKind } from "@/lib/ai/agent/contract";

const KIND_ICON: Record<AgentToolKind, LucideIcon> = {
  lookup_ip_identity: Fingerprint,
  query_logs: ScrollText,
  discover_elasticsearch_fields: Search,
  search_elasticsearch: ScrollText,
  check_threat_intel: ShieldAlert,
  get_firewall_context: Shield,
  get_related_threats: Network,
  reverse_dns: Globe,
  whois_asn: Landmark,
  ip_reputation: ShieldCheck,
  search_inventory: Search,
  get_lab_overview: Network,
  get_asset_topology: Network,
  get_entity: Box,
  list_security_tickets: ShieldAlert,
  get_security_ticket: Shield,
  get_integration_health: RefreshCw,
  list_workflows: ListChecks,
  run_workflow: Play,
  write_doc: FileText,
  ask_question: MessageCircleQuestion,
  trigger_sync: RefreshCw,
  other: Wrench,
};

/**
 * One tool invocation rendered as a compact chip. Click to toggle the result
 * preview (when present). Spinner while running; check / alert when settled.
 */
export function ToolCallChip({ call }: { call: AgentToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = KIND_ICON[call.kind] ?? Wrench;
  const hasPreview = Boolean(call.resultPreview);

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => hasPreview && setExpanded((v) => !v)}
        aria-expanded={hasPreview ? expanded : undefined}
        aria-label={`Tool ${call.label}, ${call.status}`}
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-full border bg-muted/50 py-0.5 pr-2.5 pl-2 text-xs text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          hasPreview ? "cursor-pointer hover:bg-muted hover:text-foreground" : "cursor-default",
          call.status === "error" && "border-destructive/40 text-destructive",
        )}
      >
        <Icon className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{call.label}</span>
        {call.status === "running" && (
          <Loader2
            className="size-3 shrink-0 animate-spin text-primary motion-reduce:animate-none"
            aria-hidden
          />
        )}
        {call.status === "success" && <Check className="size-3 shrink-0 text-success" aria-hidden />}
        {call.status === "error" && <AlertCircle className="size-3 shrink-0" aria-hidden />}
      </button>
      {expanded && hasPreview && (
        <pre className="mt-1 max-h-40 overflow-auto rounded-md border bg-muted/50 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {call.resultPreview}
        </pre>
      )}
    </div>
  );
}

const COLLAPSED_COUNT = 3;

/** Chip row for an assistant turn; collapses beyond a few calls. */
export function ToolCallList({ calls }: { calls: AgentToolCall[] }) {
  const [showAll, setShowAll] = useState(false);
  if (calls.length === 0) return null;

  const anyRunning = calls.some((c) => c.status === "running");
  // While tools are still streaming in, always show everything.
  const visible = showAll || anyRunning ? calls : calls.slice(0, COLLAPSED_COUNT);
  const hiddenCount = calls.length - visible.length;

  return (
    <div className="flex flex-wrap items-start gap-1.5" role="list" aria-label="Tools used">
      {visible.map((call) => (
        <ToolCallChip key={call.id} call={call} />
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="inline-flex items-center rounded-full border border-dashed px-2.5 py-0.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          +{hiddenCount} more
        </button>
      )}
      {showAll && !anyRunning && calls.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Show fewer
        </button>
      )}
    </div>
  );
}
