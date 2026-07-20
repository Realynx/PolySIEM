"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Box,
  Container as ContainerIcon,
  Monitor,
  Network as NetworkIcon,
  Server,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { EntityStatusValue, PowerStateValue } from "@/lib/types";
import {
  isEmbeddableKind,
  type NodeEmbedKind,
  type NodeEmbedSummary,
} from "@/lib/docs/node-embed";

const KIND_ICON: Record<NodeEmbedKind, typeof Server> = {
  device: Server,
  vm: Monitor,
  container: ContainerIcon,
  network: NetworkIcon,
  service: Box,
};

const KIND_LABEL: Record<NodeEmbedKind, string> = {
  device: "host",
  vm: "VM",
  container: "container",
  network: "network",
  service: "service",
};

const POWER_DOT: Record<PowerStateValue, string> = {
  RUNNING: "bg-success",
  STOPPED: "bg-muted-foreground/50",
  PAUSED: "bg-warning",
  UNKNOWN: "bg-muted-foreground/30",
};

const POWER_LABEL: Record<PowerStateValue, string> = {
  RUNNING: "Running",
  STOPPED: "Stopped",
  PAUSED: "Paused",
  UNKNOWN: "Unknown",
};

/**
 * Everything here is rendered with inline elements only (an `<a>` and `<span>`s
 * — never a block `<div>`) so the card is valid inside the paragraph react-
 * markdown wraps prose text in, and hydrates without nesting warnings.
 */
const CARD_CLASS =
  "not-prose inline-flex max-w-full items-center gap-2 rounded-md border bg-card px-2.5 py-1 align-middle text-sm no-underline ring-1 ring-foreground/10 transition-colors hover:bg-muted/60";
const CHIP_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-dashed px-2 py-0.5 align-middle text-xs text-muted-foreground";

function StatusIndicator({
  status,
  power,
}: {
  status: EntityStatusValue | null;
  power: PowerStateValue | null;
}) {
  const dot = power
    ? POWER_DOT[power]
    : status === "STALE"
      ? "bg-warning"
      : status === "REMOVED"
        ? "bg-destructive"
        : "bg-success";
  const label = power
    ? POWER_LABEL[power]
    : status === "STALE"
      ? "Stale"
      : status === "REMOVED"
        ? "Removed"
        : null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      <span className={cn("size-2 rounded-full", dot)} aria-hidden />
      {label && <span>{label}</span>}
    </span>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className={CHIP_CLASS} title={label}>
      <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

function LoadingChip() {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1 align-middle ring-1 ring-foreground/10"
      aria-busy="true"
      aria-label="Loading node…"
    >
      <span className="inline-block size-4 animate-pulse rounded bg-muted" />
      <span className="inline-block h-3 w-24 animate-pulse rounded bg-muted" />
    </span>
  );
}

/**
 * Client card for a live node embed. Fetches a fresh summary for (kind, id) via
 * the resolver and renders a compact, linked card. Malformed kinds and removed
 * entities degrade to a subtle chip instead of crashing the doc.
 */
export function NodeEmbed({ kind, id }: { kind: string; id: string }) {
  const valid = isEmbeddableKind(kind);

  const { data, isLoading, isError } = useQuery<NodeEmbedSummary | null>({
    queryKey: ["node-embed", kind, id],
    queryFn: async () => {
      const res = await fetch(
        `/api/docs/embed?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
      );
      // A missing/removed entity is an expected state, not an error to retry.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Failed to load node (${res.status})`);
      const body = (await res.json()) as { data?: NodeEmbedSummary };
      return body.data ?? null;
    },
    enabled: valid && id.length > 0,
    staleTime: 30_000,
  });

  if (!valid) return <Chip label={`Unknown node type “${kind}”`} />;
  if (isLoading) return <LoadingChip />;
  if (isError) return <Chip label={`Couldn’t load ${KIND_LABEL[kind]}`} />;
  if (!data) return <Chip label={`${KIND_LABEL[kind]} not found`} />;

  const Icon = KIND_ICON[data.kind];
  return (
    <Link href={data.href} className={CARD_CLASS}>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate font-medium text-foreground">{data.name}</span>
      <StatusIndicator status={data.status} power={data.power} />
      {data.facts.length > 0 && (
        <span className="hidden truncate text-xs text-muted-foreground sm:inline">
          {data.facts.map((f) => f.value).join(" · ")}
        </span>
      )}
      <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
    </Link>
  );
}
