"use client";

import { useEffect, useMemo, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AlertTriangle,
  Clock3,
  ChevronLeft,
  ChevronRight,
  Database,
  FilterX,
  Inbox,
  Plus,
  Radar,
  RefreshCw,
  Search,
  SearchX,
  Settings2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { OperationsOverview } from "@/components/shared/operations-overview";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRelative } from "@/lib/format";
import { useDebounced } from "@/components/shared/use-debounced";
import type {
  AiScanConfigDto,
  AiScanRunDto,
  SecurityTicketDto,
  TicketListResponse,
} from "@/lib/types";
import { SEVERITIES } from "./constants";
import { hasActiveInvestigation } from "./investigation-state";
import { NewTicketDialog } from "./new-ticket-dialog";
import { ScanConfigDialog } from "./scan-config-dialog";
import { RunStatusBadge, ScanHistory } from "./scan-history";
import { SeverityBadge } from "./severity-badge";
import { TicketSheet } from "./ticket-sheet";
import { TicketTable } from "./ticket-table";

const PAGE_SIZE = 25;

interface LogSource {
  id: string;
  name: string;
}

/** SOAR-style response panel: AI-generated and manual security tickets with scan controls. */
export function ThreatPanel({
  sources,
  isAdmin,
}: {
  sources: LogSource[];
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<"open" | "closed" | "all">("open");
  const [severity, setSeverity] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<SecurityTicketDto | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [newTicketOpen, setNewTicketOpen] = useState(false);

  const debouncedSearch = useDebounced(search, 400);

  // New filters restart pagination.
  useEffect(() => {
    setPage(1);
  }, [status, severity, debouncedSearch]);

  const params = useMemo(() => {
    const p = new URLSearchParams({
      status,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (severity !== "all") p.set("severity", severity);
    if (debouncedSearch.trim()) p.set("q", debouncedSearch.trim());
    return p;
  }, [status, severity, debouncedSearch, page]);

  const ticketsQuery = useQuery({
    queryKey: ["tickets", status, severity, debouncedSearch, page],
    queryFn: () => apiFetch<TicketListResponse>(`/api/logs/tickets?${params}`),
    placeholderData: keepPreviousData,
    // Background investigations update the tickets they run against; while any
    // are queued/running, poll the list so their badges advance without the
    // user opening the ticket. Stops once nothing is active.
    refetchInterval: (query) =>
      hasActiveInvestigation(query.state.data?.tickets) ? 3500 : false,
  });

  const runsQuery = useQuery({
    queryKey: ["scan-runs"],
    queryFn: () =>
      apiFetch<{ runs: AiScanRunDto[] }>("/api/logs/scan/runs?limit=20"),
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
    mutationFn: () =>
      apiFetch<AiScanRunDto>("/api/logs/scan/run", { method: "POST" }),
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
      if (/already running/i.test(err.message))
        toast.info("A scan is already running — hang tight.");
      else toast.error(err.message);
      refreshAll();
    },
  });

  const config = configQuery.data;
  const openCounts = ticketsQuery.data?.openCounts;
  const totalOpen = openCounts
    ? Object.values(openCounts).reduce((a, b) => a + b, 0)
    : 0;
  const urgentOpen = openCounts ? openCounts.CRITICAL + openCounts.HIGH : 0;
  const lastRun = runsQuery.data?.runs[0];

  const hasFilters =
    status !== "open" || severity !== "all" || search.trim() !== "";
  const clearFilters = () => {
    setStatus("open");
    setSeverity("all");
    setSearch("");
  };

  const total = ticketsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const neverConfigured = config !== undefined && config.model === "";

  return (
    <>
      <PageHeader
        title="SIEM tickets"
        description="Triage findings from Suricata, Cloudflared, and your other Elastic log sources in one focused security queue."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNewTicketOpen(true)}
            >
              <Plus data-icon="inline-start" />
              New ticket
            </Button>
            {isAdmin && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfigOpen(true)}
                >
                  <Settings2 data-icon="inline-start" />
                  Configure
                </Button>
                <Button
                  size="sm"
                  onClick={() => runScan.mutate()}
                  disabled={runScan.isPending}
                >
                  <Radar
                    data-icon="inline-start"
                    className={cn(runScan.isPending && "animate-spin")}
                  />
                  {runScan.isPending ? "Scanning…" : "Run scan now"}
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="space-y-4">
        <OperationsOverview
          icon={<Radar className="size-5" aria-hidden />}
          title="Security operations queue"
          description={
            config?.model
              ? `Scanning with ${config.model}`
              : "AI-assisted triage across connected log sources"
          }
          statusTone={urgentOpen > 0 ? "destructive" : "success"}
          status={
            <>
              {urgentOpen > 0 ? (
                <ShieldAlert className="size-3.5" aria-hidden />
              ) : (
                <ShieldCheck className="size-3.5" aria-hidden />
              )}
              {urgentOpen > 0
                ? `${urgentOpen} urgent ${urgentOpen === 1 ? "ticket" : "tickets"}`
                : "Queue is healthy"}
            </>
          }
          metrics={[
            {
              icon: <Inbox />,
              label: "Open tickets",
              value: totalOpen.toLocaleString(),
              detail:
                openCounts && totalOpen > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {SEVERITIES.filter((s) => openCounts[s] > 0).map((s) => (
                      <SeverityBadge
                        key={s}
                        severity={s}
                        count={openCounts[s]}
                        className="text-[0.62rem]"
                      />
                    ))}
                  </span>
                ) : (
                  "Nothing needs attention"
                ),
            },
            {
              icon: <ShieldAlert />,
              label: "Needs priority triage",
              value: urgentOpen.toLocaleString(),
              detail: urgentOpen > 0 ? "Critical and high severity" : "No urgent tickets",
              tone: urgentOpen > 0 ? "destructive" : "neutral",
            },
            {
              icon: <Clock3 />,
              label: "Last scan",
              value: lastRun ? formatRelative(lastRun.startedAt) : "Never",
              detail: lastRun ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <RunStatusBadge status={lastRun.status} />
                  <span className="truncate font-mono">{lastRun.model}</span>
                </span>
              ) : (
                "Run a scan to get started"
              ),
            },
            {
              icon: <Database />,
              label: "Events analyzed",
              value:
                lastRun?.stats?.docsScanned !== undefined
                  ? lastRun.stats.docsScanned.toLocaleString()
                  : "—",
              detail: lastRun?.stats
                ? `${lastRun.stats.ticketsCreated ?? 0} new · ${lastRun.stats.ticketsUpdated ?? 0} updated`
                : "Most recent scan",
            },
          ]}
        />

        <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-foreground/10 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Ticket queue</h2>
              <p className="text-xs text-muted-foreground">
                Review, investigate, and resolve security findings.
              </p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground">
              {total.toLocaleString()} {total === 1 ? "result" : "results"}
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-3 p-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Tabs
                value={status}
                onValueChange={(v) => setStatus(v as typeof status)}
              >
                <TabsList className="h-8">
                  <TabsTrigger value="open">Open</TabsTrigger>
                  <TabsTrigger value="closed">Closed</TabsTrigger>
                  <TabsTrigger value="all">All</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="ticket-severity-filter"
                className="text-xs text-muted-foreground"
              >
                Severity
              </Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger
                  id="ticket-severity-filter"
                  size="sm"
                  className="w-32"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All severities</SelectItem>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.toLowerCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-52 flex-1 space-y-1.5">
              <Label
                htmlFor="ticket-search"
                className="text-xs text-muted-foreground"
              >
                Search
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="ticket-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search titles, summaries, and indicators…"
                  className="h-8 pl-8 text-[0.8rem]"
                />
              </div>
            </div>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <FilterX data-icon="inline-start" />
                Clear filters
              </Button>
            )}
          </div>
        </section>

        {ticketsQuery.isError ? (
          <ErrorCard
            message={ticketsQuery.error.message}
            onRetry={() => void ticketsQuery.refetch()}
          />
        ) : ticketsQuery.isPending ? (
          <div className="space-y-2 rounded-lg border p-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : ticketsQuery.data.tickets.length === 0 ? (
          hasFilters ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-14 text-center">
              <SearchX className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">
                No tickets match your filters
              </p>
              <p className="text-sm text-muted-foreground">
                Try a different status, severity, or search.
              </p>
            </div>
          ) : neverConfigured ? (
            <EmptyState
              icon={Radar}
              title="AI scanning isn't set up yet"
              description="Configure an AI provider and PolySIEM will periodically scan Suricata, Cloudflared, and other Elastic logs, correlate what it finds, and open tickets here."
              action={
                isAdmin ? (
                  <Button onClick={() => setConfigOpen(true)}>
                    <Settings2 data-icon="inline-start" />
                    Configure AI scanning
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-14 text-center">
              <ShieldCheck className="size-6 text-success" />
              <p className="text-sm font-medium">All quiet — no open tickets</p>
              <p className="text-sm text-muted-foreground">
                {lastRun
                  ? `Last scan ${formatRelative(lastRun.startedAt)} found nothing that needs your attention.`
                  : "Run a scan to check your logs for anomalies."}
              </p>
            </div>
          )
        ) : (
          <>
            <TicketTable
              tickets={ticketsQuery.data.tickets}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
            />
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {total.toLocaleString()} ticket{total === 1 ? "" : "s"} · page{" "}
                  {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    <ChevronLeft data-icon="inline-start" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    Next
                    <ChevronRight data-icon="inline-end" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        <ScanHistory
          runs={runsQuery.data?.runs}
          isLoading={runsQuery.isPending}
        />
      </div>

      <TicketSheet
        ticket={selected}
        isAdmin={isAdmin}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onUpdated={setSelected}
      />
      <ScanConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        config={config}
        sources={sources}
      />
      <NewTicketDialog open={newTicketOpen} onOpenChange={setNewTicketOpen} />
    </>
  );
}

function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex flex-col items-start gap-3 py-6">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          <p className="font-medium">Could not load tickets</p>
        </div>
        <p className="text-sm break-all text-muted-foreground">{message}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw data-icon="inline-start" />
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}
