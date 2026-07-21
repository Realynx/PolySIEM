"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Radar, Search, SearchX, ShieldAlert, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative } from "@/lib/format";
import { useDebounced } from "@/components/shared/use-debounced";
import type { AiScanConfigDto, AiScanRunDto, SecurityTicketDto, TicketListResponse, TicketSeverityValue } from "@/lib/types";
import { hasActiveInvestigation } from "@/components/logs/threats/investigation-state";
import { InvestigationBadge } from "@/components/logs/threats/investigation-badge";
import { NewTicketDialog } from "@/components/logs/threats/new-ticket-dialog";
import { SeverityBadge, TicketStatusBadge } from "@/components/logs/threats/severity-badge";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileStat, MobileStatStrip } from "@/components/mobile/ui/mobile-stats";
import { MobileFab } from "@/components/mobile/ui/mobile-fab";
import { MobileTicketSheet } from "./mobile-ticket-sheet";

const PAGE_SIZE = 25;

const STATUS_ITEMS = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
] as const;

type StatusFilter = (typeof STATUS_ITEMS)[number]["value"];

const SEVERITY_MARK: Record<TicketSeverityValue, string> = {
  CRITICAL: "bg-destructive",
  HIGH: "bg-orange-500",
  MEDIUM: "bg-warning",
  LOW: "bg-info",
  INFO: "bg-muted-foreground",
};

/**
 * Phone Threat-watch tab: the desktop ThreatPanel's ticket queue as touch rows.
 * Shares the desktop panel's react-query keys/endpoints so caches are common;
 * detail opens in a BottomSheet, "new ticket" reuses the existing dialog.
 */
export function MobileThreatWatch({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<StatusFilter>("open");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<SecurityTicketDto | null>(null);
  const [newTicketOpen, setNewTicketOpen] = useState(false);

  const debouncedSearch = useDebounced(search, 400);

  // New filters restart pagination.
  useEffect(() => {
    setPage(1);
  }, [status, debouncedSearch]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ status, page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedSearch.trim()) p.set("q", debouncedSearch.trim());
    return p;
  }, [status, debouncedSearch, page]);

  // Same keys as the desktop ThreatPanel — the caches are shared.
  const ticketsQuery = useQuery({
    queryKey: ["tickets", status, "all", debouncedSearch, page],
    queryFn: () => apiFetch<TicketListResponse>(`/api/logs/tickets?${params}`),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (hasActiveInvestigation(query.state.data?.tickets) ? 3500 : false),
  });

  const runsQuery = useQuery({
    queryKey: ["scan-runs"],
    queryFn: () => apiFetch<{ runs: AiScanRunDto[] }>("/api/logs/scan/runs?limit=20"),
  });

  const configQuery = useQuery({
    queryKey: ["scan-config"],
    queryFn: () => apiFetch<AiScanConfigDto>("/api/logs/scan/config"),
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    void queryClient.invalidateQueries({ queryKey: ["scan-runs"] });
  };

  const runScan = useMutation({
    mutationFn: () => apiFetch<AiScanRunDto>("/api/logs/scan/run", { method: "POST" }),
    onSuccess: (run) => {
      const created = run.stats?.ticketsCreated ?? 0;
      const updated = run.stats?.ticketsUpdated ?? 0;
      if (run.status === "FAILED") {
        toast.error(run.error ?? "The scan failed.");
      } else if (created === 0 && updated === 0) {
        toast.success("Scan complete — nothing suspicious found.");
      } else {
        toast.success(
          `Scan complete — ${created} new ticket${created === 1 ? "" : "s"}${updated > 0 ? `, ${updated} updated` : ""}.`,
        );
      }
      refreshAll();
    },
    onError: (err: Error) => {
      if (/already running/i.test(err.message)) toast.info("A scan is already running — hang tight.");
      else toast.error(err.message);
      refreshAll();
    },
  });

  const openCounts = ticketsQuery.data?.openCounts;
  const totalOpen = openCounts ? Object.values(openCounts).reduce((a, b) => a + b, 0) : 0;
  const urgentOpen = openCounts ? openCounts.CRITICAL + openCounts.HIGH : 0;
  const lastRun = runsQuery.data?.runs[0];

  const total = ticketsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = status !== "open" || search.trim() !== "";
  const neverConfigured = configQuery.data !== undefined && configQuery.data.model === "";

  return (
    <>
      <section
        className={cn(
          "relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/[0.14] via-card to-card p-4 ring-1 ring-foreground/10",
          urgentOpen > 0 && "ring-destructive/25",
        )}
      >
        <div className="pointer-events-none absolute -top-12 -right-10 size-32 rounded-full bg-primary/15 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
            <Radar className={cn("size-5", runScan.isPending && "animate-spin")} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Security operations</p>
            <p className={cn("truncate text-xs text-muted-foreground", urgentOpen > 0 && "text-destructive")}>
              {urgentOpen > 0
                ? `${urgentOpen} urgent ${urgentOpen === 1 ? "ticket needs" : "tickets need"} triage`
                : configQuery.data?.model
                  ? `Queue healthy · ${configQuery.data.model}`
                  : "AI-assisted SIEM triage"}
            </p>
          </div>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="relative h-9 shrink-0 bg-background/70"
              onClick={() => runScan.mutate()}
              disabled={runScan.isPending}
            >
              {runScan.isPending ? "Scanning…" : "Run scan"}
            </Button>
          )}
        </div>
      </section>

      <MobileStatStrip>
        <MobileStat label="Open" value={openCounts ? totalOpen : "—"} />
        <MobileStat
          label="Crit + high"
          value={openCounts ? urgentOpen : "—"}
          tone={urgentOpen > 0 ? "text-destructive" : undefined}
        />
        <MobileStat label="Last scan" value={lastRun ? formatRelative(lastRun.startedAt) : "never"} />
        <MobileStat
          label="Scanned"
          value={lastRun?.stats?.docsScanned !== undefined ? lastRun.stats.docsScanned.toLocaleString() : "—"}
        />
      </MobileStatStrip>

      <div className="flex items-center gap-2">
        <div className="flex flex-1 rounded-lg bg-muted p-0.5">
          {STATUS_ITEMS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setStatus(item.value)}
              className={cn(
                "flex h-8 flex-1 items-center justify-center rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
                status === item.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground active:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          type="search"
          inputMode="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tickets…"
          aria-label="Search tickets"
          className="h-10 w-full rounded-xl border-0 bg-muted pr-3.5 pl-10 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-search-cancel-button]:hidden"
        />
      </div>

      {ticketsQuery.isError ? (
        <MobileEmpty
          icon={<ShieldAlert />}
          title="Could not load tickets"
          description={ticketsQuery.error.message}
          action={
            <Button variant="outline" size="sm" onClick={() => void ticketsQuery.refetch()}>
              Retry
            </Button>
          }
        />
      ) : ticketsQuery.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-13 w-full rounded-xl" />
          ))}
        </div>
      ) : ticketsQuery.data.tickets.length === 0 ? (
        hasFilters ? (
          <MobileEmpty
            icon={<SearchX />}
            title="No tickets match your filters"
            description="Try a different status or search."
          />
        ) : neverConfigured ? (
          <MobileEmpty
            icon={<Radar />}
            title="AI scanning isn't set up yet"
            description="Configure an AI provider on desktop and PolySIEM will scan your logs and open tickets here."
          />
        ) : (
          <MobileEmpty
            icon={<ShieldCheck />}
            title="All quiet — no open tickets"
            description={
              lastRun
                ? `Last scan ${formatRelative(lastRun.startedAt)} found nothing that needs your attention.`
                : "Run a scan to check your logs for anomalies."
            }
          />
        )
      ) : (
        <MobileSection title={`Tickets · ${total.toLocaleString()}`}>
          <MobileList>
            {ticketsQuery.data.tickets.map((ticket) => (
              <MobileListRow
                key={ticket.id}
                onClick={() => setSelected(ticket)}
                leading={<span className={cn("h-8 w-1 rounded-full", SEVERITY_MARK[ticket.severity])} />}
                className={cn(
                  ticket.status === "OPEN" &&
                    (ticket.severity === "CRITICAL" || ticket.severity === "HIGH") &&
                    "bg-destructive/[0.025]",
                )}
                title={
                  <>
                    <SeverityBadge severity={ticket.severity} className="shrink-0 text-[0.6rem]" />
                    <span className="min-w-0 truncate">{ticket.title}</span>
                  </>
                }
                subtitle={
                  <span className="flex items-center gap-1.5">
                    <TicketStatusBadge status={ticket.status} className="px-1 text-[0.6rem]" />
                    <span className="inline-flex items-center gap-0.5">
                      {ticket.createdBy === "ai" ? (
                        <Sparkles className="size-3 text-primary" aria-hidden />
                      ) : (
                        <UserRound className="size-3" aria-hidden />
                      )}
                      {ticket.category}
                    </span>
                    <span>· {formatRelative(ticket.lastSeenAt)}</span>
                    <InvestigationBadge ticket={ticket} className="px-1 text-[0.6rem]" />
                  </span>
                }
                trailing={ticket.timesSeen > 1 ? <span>{ticket.timesSeen}×</span> : undefined}
              />
            ))}
          </MobileList>
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-muted-foreground">
                page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Previous page"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Next page"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </MobileSection>
      )}

      <MobileFab aria-label="New ticket" onClick={() => setNewTicketOpen(true)}>
        <Plus />
      </MobileFab>

      <MobileTicketSheet
        ticket={selected}
        isAdmin={isAdmin}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onUpdated={setSelected}
      />
      <NewTicketDialog open={newTicketOpen} onOpenChange={setNewTicketOpen} />
    </>
  );
}
