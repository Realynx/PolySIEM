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
import { announceScan, announceScanError } from "./scan-feedback";
import { SeverityBadge } from "./severity-badge";
import { TicketSheet } from "./ticket-sheet";
import { TicketTable } from "./ticket-table";

const PAGE_SIZE = 25;

interface LogSource {
  id: string;
  name: string;
}

function ticketParams(status: string, severity: string, search: string, page: number) {
  const params = new URLSearchParams({ status, page: String(page), pageSize: String(PAGE_SIZE) });
  if (severity !== "all") params.set("severity", severity);
  if (search.trim()) params.set("q", search.trim());
  return params;
}

function ThreatHeader({ isAdmin, scanPending, onNew, onConfigure, onScan }: { isAdmin: boolean; scanPending: boolean; onNew: () => void; onConfigure: () => void; onScan: () => void }) {
  return <PageHeader title="SIEM tickets" description="Triage findings from Suricata, Cloudflared, and your other Elastic log sources in one focused security queue." actions={<><Button variant="outline" size="sm" onClick={onNew}><Plus data-icon="inline-start" />New ticket</Button>{isAdmin && <><Button variant="outline" size="sm" onClick={onConfigure}><Settings2 data-icon="inline-start" />Configure</Button><Button size="sm" onClick={onScan} disabled={scanPending}><Radar data-icon="inline-start" className={cn(scanPending && "animate-spin")} />{scanPending ? "Scanning…" : "Run scan now"}</Button></>}</>} />;
}

function openTicketsMetric(openCounts: TicketListResponse["openCounts"] | undefined, totalOpen: number) {
  return { icon: <Inbox />, label: "Open tickets", value: totalOpen.toLocaleString(), detail: openCounts && totalOpen > 0 ? <span className="flex flex-wrap gap-1">{SEVERITIES.filter((severity) => openCounts[severity] > 0).map((severity) => <SeverityBadge key={severity} severity={severity} count={openCounts[severity]} className="text-[0.62rem]" />)}</span> : "Nothing needs attention" };
}

function urgentTicketsMetric(urgentOpen: number) {
  return { icon: <ShieldAlert />, label: "Needs priority triage", value: urgentOpen.toLocaleString(), detail: urgentOpen > 0 ? "Critical and high severity" : "No urgent tickets", tone: urgentOpen > 0 ? "destructive" as const : "neutral" as const };
}

function lastScanMetric(lastRun: AiScanRunDto | undefined) {
  return { icon: <Clock3 />, label: "Last scan", value: lastRun ? formatRelative(lastRun.startedAt) : "Never", detail: lastRun ? <span className="flex min-w-0 items-center gap-1.5"><RunStatusBadge status={lastRun.status} /><span className="truncate font-mono">{lastRun.model}</span></span> : "Run a scan to get started" };
}

function eventsMetric(lastRun: AiScanRunDto | undefined) {
  return { icon: <Database />, label: "Events analyzed", value: lastRun?.stats?.docsScanned !== undefined ? lastRun.stats.docsScanned.toLocaleString() : "—", detail: lastRun?.stats ? `${lastRun.stats.ticketsCreated ?? 0} new · ${lastRun.stats.ticketsUpdated ?? 0} updated` : "Most recent scan" };
}

function QueueOverview({ config, openCounts, lastRun }: { config: AiScanConfigDto | undefined; openCounts: TicketListResponse["openCounts"] | undefined; lastRun: AiScanRunDto | undefined }) {
  const totalOpen = openCounts ? Object.values(openCounts).reduce((sum, count) => sum + count, 0) : 0;
  const urgentOpen = openCounts ? openCounts.CRITICAL + openCounts.HIGH : 0;
  return <OperationsOverview icon={<Radar className="size-5" aria-hidden />} title="Security operations queue" description={config?.model ? `Scanning with ${config.model}` : "AI-assisted triage across connected log sources"} statusTone={urgentOpen > 0 ? "destructive" : "success"} status={<>{urgentOpen > 0 ? <ShieldAlert className="size-3.5" aria-hidden /> : <ShieldCheck className="size-3.5" aria-hidden />}{urgentOpen > 0 ? `${urgentOpen} urgent ${urgentOpen === 1 ? "ticket" : "tickets"}` : "Queue is healthy"}</>} metrics={[openTicketsMetric(openCounts, totalOpen), urgentTicketsMetric(urgentOpen), lastScanMetric(lastRun), eventsMetric(lastRun)]} />;
}

function TicketFilters({ status, setStatus, severity, setSeverity, search, setSearch, total, hasFilters, clearFilters }: { status: "open" | "closed" | "all"; setStatus: (value: "open" | "closed" | "all") => void; severity: string; setSeverity: (value: string) => void; search: string; setSearch: (value: string) => void; total: number; hasFilters: boolean; clearFilters: () => void }) {
  return <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-foreground/10 px-4 py-3"><div><h2 className="text-sm font-semibold">Ticket queue</h2><p className="text-xs text-muted-foreground">Review, investigate, and resolve security findings.</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground">{total.toLocaleString()} {total === 1 ? "result" : "results"}</span></div><div className="flex flex-wrap items-end gap-3 p-4">
    <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Status</Label><Tabs value={status} onValueChange={(value) => setStatus(value as typeof status)}><TabsList className="h-8"><TabsTrigger value="open">Open</TabsTrigger><TabsTrigger value="closed">Closed</TabsTrigger><TabsTrigger value="all">All</TabsTrigger></TabsList></Tabs></div>
    <div className="space-y-1.5"><Label htmlFor="ticket-severity-filter" className="text-xs text-muted-foreground">Severity</Label><Select value={severity} onValueChange={setSeverity}><SelectTrigger id="ticket-severity-filter" size="sm" className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All severities</SelectItem>{SEVERITIES.map((item) => <SelectItem key={item} value={item}>{item.toLowerCase()}</SelectItem>)}</SelectContent></Select></div>
    <div className="min-w-52 flex-1 space-y-1.5"><Label htmlFor="ticket-search" className="text-xs text-muted-foreground">Search</Label><div className="relative"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input id="ticket-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search titles, summaries, and indicators…" className="h-8 pl-8 text-[0.8rem]" /></div></div>
    {hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters}><FilterX data-icon="inline-start" />Clear filters</Button>}
  </div></section>;
}

function EmptyTickets({ hasFilters, neverConfigured, isAdmin, lastRun, onConfigure }: { hasFilters: boolean; neverConfigured: boolean; isAdmin: boolean; lastRun: AiScanRunDto | undefined; onConfigure: () => void }) {
  if (hasFilters) return <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-14 text-center"><SearchX className="size-6 text-muted-foreground" /><p className="text-sm font-medium">No tickets match your filters</p><p className="text-sm text-muted-foreground">Try a different status, severity, or search.</p></div>;
  if (neverConfigured) return <EmptyState icon={Radar} title="AI scanning isn't set up yet" description="Configure an AI provider and PolySIEM will periodically scan Suricata, Cloudflared, and other Elastic logs, correlate what it finds, and open tickets here." action={isAdmin ? <Button onClick={onConfigure}><Settings2 data-icon="inline-start" />Configure AI scanning</Button> : undefined} />;
  return <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-14 text-center"><ShieldCheck className="size-6 text-success" /><p className="text-sm font-medium">All quiet — no open tickets</p><p className="text-sm text-muted-foreground">{lastRun ? `Last scan ${formatRelative(lastRun.startedAt)} found nothing that needs your attention.` : "Run a scan to check your logs for anomalies."}</p></div>;
}

function TicketResults({ query, selected, setSelected, total, page, setPage, totalPages, hasFilters, neverConfigured, isAdmin, lastRun, onConfigure }: { query: ReturnType<typeof useQuery<TicketListResponse>>; selected: SecurityTicketDto | null; setSelected: (ticket: SecurityTicketDto | null) => void; total: number; page: number; setPage: (update: number | ((current: number) => number)) => void; totalPages: number; hasFilters: boolean; neverConfigured: boolean; isAdmin: boolean; lastRun: AiScanRunDto | undefined; onConfigure: () => void }) {
  if (query.isError) return <ErrorCard message={query.error.message} onRetry={() => void query.refetch()} />;
  if (query.isPending) return <div className="space-y-2 rounded-lg border p-3">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-9 w-full" />)}</div>;
  if (query.data.tickets.length === 0) return <EmptyTickets hasFilters={hasFilters} neverConfigured={neverConfigured} isAdmin={isAdmin} lastRun={lastRun} onConfigure={onConfigure} />;
  return <><TicketTable tickets={query.data.tickets} selectedId={selected?.id ?? null} onSelect={setSelected} />{totalPages > 1 && <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">{total.toLocaleString()} ticket{total === 1 ? "" : "s"} · page {page} of {totalPages}</p><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}><ChevronLeft data-icon="inline-start" />Previous</Button><Button variant="outline" size="sm" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>Next<ChevronRight data-icon="inline-end" /></Button></div></div>}</>;
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

  const params = useMemo(() => ticketParams(status, severity, debouncedSearch, page), [status, severity, debouncedSearch, page]);

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
      announceScan(run);
      refreshAll();
    },
    onError: (err: Error) => {
      announceScanError(err);
      refreshAll();
    },
  });

  const config = configQuery.data;
  const openCounts = ticketsQuery.data?.openCounts;
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
      <ThreatHeader isAdmin={isAdmin} scanPending={runScan.isPending} onNew={() => setNewTicketOpen(true)} onConfigure={() => setConfigOpen(true)} onScan={() => runScan.mutate()} />

      <div className="space-y-4">
        <QueueOverview config={config} openCounts={openCounts} lastRun={lastRun} />

        <TicketFilters status={status} setStatus={setStatus} severity={severity} setSeverity={setSeverity} search={search} setSearch={setSearch} total={total} hasFilters={hasFilters} clearFilters={clearFilters} />
        <TicketResults query={ticketsQuery} selected={selected} setSelected={setSelected} total={total} page={page} setPage={setPage} totalPages={totalPages} hasFilters={hasFilters} neverConfigured={neverConfigured} isAdmin={isAdmin} lastRun={lastRun} onConfigure={() => setConfigOpen(true)} />

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
