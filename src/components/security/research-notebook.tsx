"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BookOpen,
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  Coins,
  Database,
  ExternalLink,
  FileSearch,
  Globe2,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldQuestion,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/components/shared/api-client";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type EvidenceStatus = "success" | "error" | "unavailable";

type ResearchEvidence = {
  id: string;
  runId: string;
  provider: string;
  kind: string;
  status: EvidenceStatus;
  title: string;
  summary: string | null;
  query: string | null;
  sourceUrl: string | null;
  data: unknown;
  capturedAt: string;
};

type ResearchPage = {
  id: string;
  title: string;
  subject: string;
  subjectType: "ip" | "domain";
  status: "open" | "archived";
  verdict: "unknown" | "benign" | "suspicious" | "malicious";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lastResearchedAt: string | null;
  createdBy: { id: string; username: string; displayName: string | null } | null;
  evidence: ResearchEvidence[];
};

type CensysEvidenceData = {
  cached?: boolean;
  estimatedProviderCredits?: number;
  host?: {
    ip?: string;
    serviceCount?: number;
    services?: Array<{
      port?: number | string | null;
      transport?: string | null;
      protocol?: string | null;
      observedAt?: string | null;
      software?: Array<{ vendor?: string | null; product?: string | null; version?: string | null }>;
    }>;
  };
};

const providerMeta: Record<string, { label: string; icon: typeof Globe2; className: string }> = {
  dns: { label: "DNS", icon: Globe2, className: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  polysiem: { label: "PolySIEM", icon: Network, className: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  elasticsearch: { label: "Logs", icon: Database, className: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  censys: { label: "Censys", icon: Search, className: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" },
  securitytrails: { label: "SecurityTrails", icon: FileSearch, className: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" },
};

function displayDate(value: string | null) {
  if (!value) return "Not researched yet";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function groupEvidence(evidence: ResearchEvidence[]) {
  const groups = new Map<string, ResearchEvidence[]>();
  for (const item of evidence) groups.set(item.runId, [...(groups.get(item.runId) ?? []), item]);
  return [...groups.entries()].map(([runId, items]) => ({ runId, items, capturedAt: items[0]?.capturedAt ?? "" }));
}

function EvidenceCard({ evidence }: { evidence: ResearchEvidence }) {
  const meta = providerMeta[evidence.provider] ?? { label: evidence.provider, icon: Database, className: "bg-muted text-muted-foreground" };
  const Icon = meta.icon;
  const censys = evidence.provider === "censys" && evidence.status === "success"
    ? evidence.data as CensysEvidenceData
    : null;
  const censysServices = censys?.host?.services ?? [];
  return (
    <article className={cn("rounded-xl border bg-background/80 p-3 shadow-sm", evidence.status !== "success" && "border-amber-500/35 bg-amber-500/[0.04]")}> 
      <div className="flex items-start gap-3">
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", meta.className)}><Icon className="size-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium leading-5">{evidence.title}</p>
              <p className="text-xs text-muted-foreground">{meta.label} · {evidence.kind}</p>
            </div>
            {evidence.status !== "success" && (
              <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                <CircleAlert className="size-3" /> {evidence.status}
              </Badge>
            )}
          </div>
          {evidence.summary && <p className="mt-2 text-sm text-muted-foreground">{evidence.summary}</p>}
          {censys?.host && (
            <div className="mt-3 rounded-lg border bg-muted/25 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Observed services</p>
                <Badge variant="outline" className={censys.cached ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
                  {censys.cached ? "Cached · 0 credits" : `${censys.estimatedProviderCredits ?? 1} Censys credit`}
                </Badge>
              </div>
              {censysServices.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {censysServices.map((service, index) => {
                    const software = service.software?.map((item) => [item.vendor, item.product, item.version].filter(Boolean).join(" ")).filter(Boolean).join(", ");
                    return (
                      <div key={`${service.port ?? "service"}-${index}`} className="rounded-lg border bg-background px-2.5 py-2 text-xs">
                        <p className="font-mono font-semibold">{service.port ?? "?"}/{service.transport ?? "tcp"} · {service.protocol ?? "unknown"}</p>
                        {software && <p className="mt-0.5 max-w-64 truncate text-muted-foreground" title={software}>{software}</p>}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">Censys did not return any observed services for this host snapshot.</p>
              )}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            <details className="group">
              <summary className="cursor-pointer select-none text-primary hover:underline">View captured evidence</summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/70 p-3 text-[11px] leading-5 text-foreground">
                {JSON.stringify(evidence.data, null, 2)}
              </pre>
            </details>
            {evidence.sourceUrl && (
              <a href={evidence.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                Open provider <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function NewResearchDialog({ open, onOpenChange, busy, initialSubject, onCreate }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  initialSubject?: string;
  onCreate: (input: { subject: string; title?: string }) => void;
}) {
  const [subject, setSubject] = useState("");
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (open) setSubject(initialSubject ?? "");
    else { setSubject(""); setTitle(""); }
  }, [initialSubject, open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Start a research page</DialogTitle>
          <DialogDescription>Enter the suspicious address exactly as it appeared. PolySIEM will preserve it and gather evidence from every available source.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="research-subject">Domain or IP address</Label>
            <Input id="research-subject" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="suspicious.example or 203.0.113.42" autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="research-title">Page title <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="research-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Possible credential-phishing infrastructure" />
          </div>
          <div className="rounded-lg border bg-muted/35 p-3 text-xs text-muted-foreground">
            The first evidence run checks DNS, the lab inventory, the last 24 hours of logs, and SecurityTrails. Censys stays optional so a host lookup is only spent when you explicitly request it.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !subject.trim()} onClick={() => onCreate({ subject, ...(title.trim() ? { title } : {}) })}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Create & research
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ResearchNotebook() {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [censysOpen, setCensysOpen] = useState(false);
  const [initialSubject, setInitialSubject] = useState("");
  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("");
  const [hours, setHours] = useState("24");

  const pagesQuery = useQuery({ queryKey: ["security-research"], queryFn: () => apiFetch<ResearchPage[]>("/api/security/research") });
  const pages = pagesQuery.data ?? [];
  const activePage = pages.find((page) => page.id === activeId) ?? pages[0] ?? null;

  useEffect(() => {
    if (activePage) { setNotes(activePage.notes ?? ""); setTitle(activePage.title); }
  }, [activePage]);

  useEffect(() => {
    const subject = new URLSearchParams(window.location.search).get("subject")?.trim();
    if (subject) { setInitialSubject(subject); setNewOpen(true); }
  }, []);

  const openNewPage = () => { setInitialSubject(""); setNewOpen(true); };

  const replacePage = (updated: ResearchPage) => {
    queryClient.setQueryData<ResearchPage[]>(["security-research"], (current = []) =>
      current.map((page) => page.id === updated.id ? updated : page));
  };

  const collectMutation = useMutation({
    mutationFn: ({ id, selectedHours = 24, providers }: { id: string; selectedHours?: number; providers?: string[] }) => apiFetch<ResearchPage>(`/api/security/research/${id}/collect`, {
      method: "POST", body: JSON.stringify({ hours: selectedHours, ...(providers ? { providers } : {}) }),
    }),
    onSuccess: (page, variables) => {
      replacePage(page);
      toast.success(variables.providers?.includes("censys") ? "Censys evidence captured." : "Evidence run captured.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createMutation = useMutation({
    mutationFn: async (input: { subject: string; title?: string }) => {
      const page = await apiFetch<ResearchPage>("/api/security/research", { method: "POST", body: JSON.stringify(input) });
      queryClient.setQueryData<ResearchPage[]>(["security-research"], (current = []) => [page, ...current]);
      setActiveId(page.id);
      setNewOpen(false);
      return apiFetch<ResearchPage>(`/api/security/research/${page.id}/collect`, { method: "POST", body: JSON.stringify({ hours: 24 }) });
    },
    onSuccess: (page) => { replacePage(page); toast.success("Research page created with its first evidence run."); },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<ResearchPage, "title" | "notes" | "verdict" | "status">> }) =>
      apiFetch<ResearchPage>(`/api/security/research/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: (page) => { replacePage(page); toast.success("Research page saved."); },
    onError: (error: Error) => toast.error(error.message),
  });

  const evidenceRuns = useMemo(() => groupEvidence(activePage?.evidence ?? []), [activePage?.evidence]);

  return (
    <>
      <PageHeader
        title="Research notebook"
        description="Build a lasting evidence trail for suspicious domains and IP addresses found in your logs."
        actions={<Button onClick={openNewPage}><Plus className="size-4" /> New research page</Button>}
      />

      {pagesQuery.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]"><Skeleton className="h-[650px]" /><Skeleton className="h-[650px]" /></div>
      ) : pagesQuery.isError ? (
        <EmptyState icon={CircleAlert} title="Could not open the research notebook" description={(pagesQuery.error as Error).message} />
      ) : pages.length === 0 ? (
        <Card className="overflow-hidden border-dashed">
          <CardContent className="flex min-h-[430px] flex-col items-center justify-center bg-[radial-gradient(circle_at_center,var(--color-muted)_0,transparent_68%)] text-center">
            <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"><BookOpen className="size-8" /></div>
            <h2 className="text-xl font-semibold">Your first investigation starts here</h2>
            <p className="mt-2 max-w-lg text-sm text-muted-foreground">Create a page for an address from your logs. Evidence stays timestamped, so later research adds history instead of overwriting what you found.</p>
            <Button className="mt-5" onClick={openNewPage}><Plus className="size-4" /> Start researching</Button>
          </CardContent>
        </Card>
      ) : activePage ? (
        <div className="grid min-h-[680px] overflow-hidden rounded-2xl border bg-card shadow-sm lg:grid-cols-[285px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b bg-muted/25 lg:border-r lg:border-b-0">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold"><BookOpen className="size-4 text-primary" /> Page index</div>
              <Badge variant="secondary">{pages.filter((page) => page.status === "open").length} open</Badge>
            </div>
            <ScrollArea className="max-h-64 lg:max-h-none lg:flex-1">
              <div className="space-y-1 p-2">
                {pages.map((page, index) => (
                  <button key={page.id} type="button" onClick={() => setActiveId(page.id)} className={cn(
                    "group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors",
                    activePage.id === page.id ? "bg-background shadow-sm ring-1 ring-border" : "hover:bg-background/60",
                    page.status === "archived" && "opacity-60",
                  )}>
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold", activePage.id === page.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{page.title}</span>
                      <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">{page.subject}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            </ScrollArea>
            <div className="border-t p-3"><Button variant="outline" className="w-full" onClick={openNewPage}><Plus className="size-4" /> Add a page</Button></div>
          </aside>

          <main className="relative min-w-0 bg-[linear-gradient(90deg,transparent_0,transparent_calc(50%-1px),var(--color-border)_50%,transparent_calc(50%+1px))]">
            <div className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/[0.06] to-transparent dark:from-black/20" />
            <div className="grid min-h-full xl:grid-cols-2">
              <section className="min-w-0 border-b p-5 sm:p-7 xl:border-r xl:border-b-0">
                <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap gap-2">
                      <Badge variant="outline" className="uppercase">{activePage.subjectType}</Badge>
                      <Badge variant={activePage.status === "open" ? "secondary" : "outline"}>{activePage.status}</Badge>
                    </div>
                    <input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Research page title" className="w-full border-0 bg-transparent p-0 text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground" />
                    <p className="mt-2 break-all font-mono text-sm text-primary">{activePage.subject}</p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border bg-background/60 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Assessment</p>
                    <Select value={activePage.verdict} onValueChange={(verdict: ResearchPage["verdict"]) => updateMutation.mutate({ id: activePage.id, patch: { verdict } })}>
                      <SelectTrigger className="mt-2 w-full bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unknown">Unknown</SelectItem><SelectItem value="benign">Benign</SelectItem><SelectItem value="suspicious">Suspicious</SelectItem><SelectItem value="malicious">Malicious</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="rounded-xl border bg-background/60 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last evidence run</p>
                    <p className="mt-2 flex items-start gap-2 text-sm"><CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> {displayDate(activePage.lastResearchedAt)}</p>
                  </div>
                </div>

                <div className="mt-6 space-y-2">
                  <div className="flex items-center justify-between"><Label htmlFor="research-notes">Analyst notes</Label><span className="text-xs text-muted-foreground">{notes.length.toLocaleString()} characters</span></div>
                  <Textarea id="research-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Record hypotheses, pivots, and conclusions. Evidence captures remain unchanged below." className="min-h-60 resize-y bg-background/70 leading-6" />
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <Button variant="ghost" size="sm" onClick={() => updateMutation.mutate({ id: activePage.id, patch: { status: activePage.status === "open" ? "archived" : "open" } })}>
                      {activePage.status === "open" ? <Archive className="size-4" /> : <BookOpen className="size-4" />} {activePage.status === "open" ? "Archive page" : "Reopen page"}
                    </Button>
                    <Button size="sm" disabled={updateMutation.isPending || (!title.trim())} onClick={() => updateMutation.mutate({ id: activePage.id, patch: { title: title.trim(), notes } })}>
                      {updateMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save page
                    </Button>
                  </div>
                </div>

                <div className="mt-8 border-t pt-4 text-xs text-muted-foreground">
                  Opened by {activePage.createdBy?.displayName || activePage.createdBy?.username || "a former user"} on {displayDate(activePage.createdAt)}.
                </div>
              </section>

              <section className="min-w-0 p-5 sm:p-7">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div><h2 className="font-semibold">Evidence trail</h2><p className="text-sm text-muted-foreground">Every run is preserved as a dated snapshot.</p></div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Select value={hours} onValueChange={setHours}>
                      <SelectTrigger className="w-[112px] bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="1">Last hour</SelectItem><SelectItem value="24">Last 24h</SelectItem><SelectItem value="168">Last 7d</SelectItem></SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" disabled={collectMutation.isPending} title="Loads the full Censys host profile, including observed services." onClick={() => setCensysOpen(true)}>
                      {collectMutation.isPending && collectMutation.variables?.providers?.includes("censys") ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Censys host & services
                    </Button>
                    <Button size="sm" disabled={collectMutation.isPending} onClick={() => collectMutation.mutate({ id: activePage.id, selectedHours: Number(hours) })}>
                      {collectMutation.isPending && !collectMutation.variables?.providers ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Research now
                    </Button>
                  </div>
                </div>

                {evidenceRuns.length === 0 ? (
                  <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center">
                    <ShieldQuestion className="mb-3 size-8 text-muted-foreground" />
                    <p className="font-medium">No evidence captured yet</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">Run research to query every connected source without changing your notes.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {evidenceRuns.map((run, index) => (
                      <section key={run.runId}>
                        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <span className={cn("flex size-5 items-center justify-center rounded-full", index === 0 ? "bg-primary text-primary-foreground" : "bg-muted")}>
                            {index === 0 ? <Check className="size-3" /> : evidenceRuns.length - index}
                          </span>
                          {displayDate(run.capturedAt)} · {run.items.filter((item) => item.status === "success").length}/{run.items.length} sources captured
                        </div>
                        <div className="space-y-2 border-l pl-3">{run.items.map((item) => <EvidenceCard key={item.id} evidence={item} />)}</div>
                      </section>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </main>
        </div>
      ) : null}

      <NewResearchDialog open={newOpen} onOpenChange={setNewOpen} busy={createMutation.isPending} initialSubject={initialSubject} onCreate={(input) => createMutation.mutate(input)} />
      <Dialog open={censysOpen} onOpenChange={setCensysOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Load Censys host and services?</DialogTitle>
            <DialogDescription>
              PolySIEM checks its four-day cache first. A cache hit costs nothing. Otherwise, Censys currently charges one provider credit for each host profile returned.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-sm text-amber-900 dark:text-amber-100">
            <div className="flex gap-2"><Coins className="mt-0.5 size-4 shrink-0" /><p>{activePage?.subjectType === "domain" ? "This domain can resolve to as many as four hosts, so a fully uncached lookup may use up to four Censys credits." : "An uncached lookup for this IP should use one Censys credit."} The saved result includes ownership, DNS names, location, ports, protocols, and detected software when Censys has them.</p></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCensysOpen(false)}>Cancel</Button>
            <Button disabled={!activePage || collectMutation.isPending} onClick={() => {
              if (!activePage) return;
              setCensysOpen(false);
              collectMutation.mutate({ id: activePage.id, providers: ["censys"] });
            }}>
              <Search className="size-4" /> Load host & services
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
