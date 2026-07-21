"use client";

import { useState } from "react";
import {
  ArrowRightLeft,
  Boxes,
  BrickWall,
  Check,
  ChevronDown,
  CircleX,
  FileText,
  Fingerprint,
  Gauge,
  Globe,
  ListChecks,
  LoaderCircle,
  MessageCircleQuestion,
  Minimize2,
  Network,
  Play,
  RefreshCw,
  ScrollText,
  Search,
  ShieldAlert,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentToolCall, AgentToolKind } from "@/lib/ai/agent/contract";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const TOOL_ICONS: Record<AgentToolKind, LucideIcon> = {
  lookup_ip_identity: Fingerprint,
  query_logs: ScrollText,
  discover_elasticsearch_fields: Search,
  search_elasticsearch: ScrollText,
  check_threat_intel: ShieldAlert,
  get_firewall_context: BrickWall,
  get_related_threats: Network,
  reverse_dns: ArrowRightLeft,
  whois_asn: Globe,
  ip_reputation: Gauge,
  search_inventory: Search,
  get_lab_overview: Network,
  get_asset_topology: Network,
  get_entity: Boxes,
  list_security_tickets: ShieldAlert,
  get_security_ticket: ShieldAlert,
  get_integration_health: RefreshCw,
  list_workflows: ListChecks,
  run_workflow: Play,
  write_doc: FileText,
  ask_question: MessageCircleQuestion,
  compact_interview: Minimize2,
  trigger_sync: RefreshCw,
  other: Wrench,
};

function toolIcon(kind: AgentToolKind): LucideIcon {
  return TOOL_ICONS[kind] ?? Wrench;
}

function StatusIcon({ status }: { status: AgentToolCall["status"] }) {
  if (status === "running") return <LoaderCircle className="size-3 animate-spin text-muted-foreground" aria-label="running" />;
  if (status === "error") return <CircleX className="size-3 text-destructive" aria-label="failed" />;
  return <Check className="size-3 text-success" aria-label="done" />;
}

/** Live tool-call chips shown while the agent is researching. */
export function ToolCallChips({ calls, className }: { calls: AgentToolCall[]; className?: string }) {
  if (calls.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {calls.map((call) => {
        const Icon = toolIcon(call.kind);
        return (
          <span
            key={call.id}
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
              call.status === "running" ? "border-primary/30 bg-primary/5" : "bg-muted/40",
              call.status === "error" && "border-destructive/40 bg-destructive/5",
            )}
          >
            <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{call.label}</span>
            <StatusIcon status={call.status} />
          </span>
        );
      })}
    </div>
  );
}

/**
 * Collapsible "How the AI investigated" provenance trail: every tool call the
 * agent made (with result previews) plus the external services it contacted.
 */
export function ToolCallTrail({
  toolCalls,
  externalSourcesUsed,
  model,
}: {
  toolCalls: AgentToolCall[];
  externalSourcesUsed: string[];
  model?: string;
}) {
  const [open, setOpen] = useState(false);
  if (toolCalls.length === 0 && externalSourcesUsed.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/40">
        <Search className="size-3.5 shrink-0" aria-hidden />
        How the AI investigated
        <span className="font-normal">
          · {toolCalls.length} tool call{toolCalls.length === 1 ? "" : "s"}
          {model && <span className="font-mono"> · {model}</span>}
        </span>
        <ChevronDown className={cn("ml-auto size-3.5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 border-t px-3 py-2">
          {toolCalls.length > 0 && (
            <ol className="space-y-1">
              {toolCalls.map((call) => {
                const Icon = toolIcon(call.kind);
                return (
                  <li key={call.id} className="flex items-start gap-2 text-xs">
                    <Icon className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <span className={cn(call.status === "error" && "text-destructive")}>{call.label}</span>{" "}
                      <span className="font-mono text-muted-foreground">({call.name})</span>
                      {call.resultPreview && (
                        <p className="truncate font-mono text-muted-foreground">{call.resultPreview}</p>
                      )}
                    </div>
                    <StatusIcon status={call.status} />
                  </li>
                );
              })}
            </ol>
          )}
          {externalSourcesUsed.length > 0 && (
            <p className="text-xs text-muted-foreground">
              External services contacted:{" "}
              {externalSourcesUsed.map((source, i) => (
                <span key={source}>
                  {i > 0 && ", "}
                  <span className="font-mono">{source}</span>
                </span>
              ))}
            </p>
          )}
          {externalSourcesUsed.length === 0 && toolCalls.length > 0 && (
            <p className="text-xs text-muted-foreground">No external services were contacted this run.</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
