"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BookOpen,
  CalendarClock,
  Check,
  CircleAlert,
  Coins,
  Database,
  ExternalLink,
  FileSearch,
  FileText,
  FolderTree,
  Globe2,
  Link2,
  Loader2,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldQuestion,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/components/shared/api-client";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Markdown } from "@/components/docs/markdown";
import { ResearchEvidenceEditor } from "@/components/security/research-evidence-editor";
import {
  RESEARCH_QUERY_KEY,
  buildResearchTree,
  displayResearchDate,
  filterResearchTree,
  groupResearchEvidence,
  researchAncestorChain,
  researchDescendantIds,
  type ResearchEvidence,
  type ResearchPage,
  type ResearchTreeNode,
} from "@/components/security/research-notebook-model";
import { expandEvidenceReferences } from "@/lib/security/research-evidence-links";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { cn } from "@/lib/utils";

type CensysEvidenceData = {
  cached?: boolean;
  estimatedProviderCredits?: number;
  host?: {
    services?: Array<{
      port?: number | string | null;
      transport?: string | null;
      protocol?: string | null;
      software?: Array<{ vendor?: string | null; product?: string | null; version?: string | null }>;
    }>;
  };
};

const NO_PARENT = "__none__";

const providerMeta: Record<string, { label: string; icon: typeof Globe2; className: string }> = {
  dns: { label: "DNS", icon: Globe2, className: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  polysiem: { label: "PolySIEM", icon: Network, className: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  elasticsearch: { label: "Logs", icon: Database, className: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  censys: { label: "Censys", icon: Search, className: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" },
  securitytrails: { label: "SecurityTrails", icon: FileSearch, className: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" },
};

const verdictMeta: Record<ResearchPage["verdict"], { label: string; className: string }> = {
  unknown: { label: "Unknown", className: "border-border bg-muted text-muted-foreground" },
  benign: { label: "Benign", className: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  suspicious: { label: "Suspicious", className: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  malicious: { label: "Malicious", className: "border-destructive/35 bg-destructive/10 text-destructive" },
};

function displayShortDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function ResearchTree({
  nodes,
  activeId,
  onSelect,
  depth = 0,
}: {
  nodes: ResearchTreeNode[];
  activeId: string;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  return (
    <ul className={cn("space-y-0.5", depth > 0 && "ml-4 border-l pl-2")}>
      {nodes.map((node) => (
        <li key={node.page.id}>
          <button
            type="button"
            onClick={() => onSelect(node.page.id)}
            className={cn(
              "group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
              activeId === node.page.id ? "bg-primary/10 text-primary" : "hover:bg-muted",
              node.page.status === "archived" && "opacity-60",
            )}
          >
            <FileText className="size-4 shrink-0 text-muted-foreground group-hover:text-current" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{node.page.title}</span>
              <span className="block truncate font-mono text-[11px] text-muted-foreground">{node.page.subject}</span>
            </span>
            {node.children.length > 0 && <span className="text-[10px] tabular-nums text-muted-foreground">{node.children.length}</span>}
          </button>
          {node.children.length > 0 && (
            <ResearchTree nodes={node.children} activeId={activeId} onSelect={onSelect} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}

function EvidenceCard({
  evidence,
  onInsert,
}: {
  evidence: ResearchEvidence;
  onInsert: (evidence: ResearchEvidence, embed: boolean) => void;
}) {
  const meta = providerMeta[evidence.provider] ?? { label: evidence.provider, icon: Database, className: "bg-muted text-muted-foreground" };
  const Icon = meta.icon;
  const censys = evidence.provider === "censys" && evidence.status === "success" ? evidence.data as CensysEvidenceData : null;
  const censysServices = censys?.host?.services ?? [];
  return (
    <article
      id={`evidence-${evidence.id}`}
      className={cn(
        "scroll-mt-6 rounded-lg border bg-background p-3 transition-colors target:border-primary target:ring-2 target:ring-primary/20",
        evidence.status !== "success" && "border-amber-500/35 bg-amber-500/[0.04]",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", meta.className)}>
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium leading-5">{evidence.title}</p>
              <p className="text-[11px] text-muted-foreground">{meta.label} · {evidence.kind}</p>
            </div>
            {evidence.status !== "success" && (
              <Badge variant="outline" className="shrink-0 border-amber-500/40 px-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                {evidence.status}
              </Badge>
            )}
          </div>
          {evidence.summary && <p className="mt-2 text-xs leading-5 text-muted-foreground">{evidence.summary}</p>}
          {censysServices.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {censysServices.slice(0, 8).map((service, index) => {
                const software = service.software?.map((item) => [item.vendor, item.product, item.version].filter(Boolean).join(" ")).filter(Boolean).join(", ");
                return (
                  <span key={`${service.port ?? "service"}-${index}`} title={software} className="max-w-full truncate rounded-md border bg-muted/30 px-1.5 py-1 font-mono text-[10px]">
                    {service.port ?? "?"}/{service.transport ?? "tcp"} · {service.protocol ?? "unknown"}
                  </span>
                );
              })}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <button type="button" onClick={() => onInsert(evidence, false)} className="inline-flex items-center gap-1 text-primary hover:underline">
              <Link2 className="size-3" /> Cite
            </button>
            <button type="button" onClick={() => onInsert(evidence, true)} className="inline-flex items-center gap-1 text-primary hover:underline">
              <FileSearch className="size-3" /> Embed
            </button>
            <details className="group basis-full">
              <summary className="cursor-pointer select-none text-primary hover:underline">View captured data</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/70 p-2 text-[10px] leading-5 text-foreground">
                {JSON.stringify(evidence.data, null, 2)}
              </pre>
            </details>
            {evidence.sourceUrl && (
              <a href={evidence.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                Provider <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function NewResearchDialog({
  open,
  onOpenChange,
  busy,
  initialSubject,
  initialParentId,
  pages,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  initialSubject?: string;
  initialParentId?: string | null;
  pages: ResearchPage[];
  onCreate: (input: { subject: string; title?: string; parentId: string | null }) => void;
}) {
  const [subject, setSubject] = useState("");
  const [title, setTitle] = useState("");
  const [parentId, setParentId] = useState(NO_PARENT);

  useEffect(() => {
    if (open) {
      setSubject(initialSubject ?? "");
      setParentId(initialParentId ?? NO_PARENT);
    } else {
      setSubject("");
      setTitle("");
      setParentId(NO_PARENT);
    }
  }, [initialParentId, initialSubject, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initialParentId ? "Add a child research page" : "Start a research page"}</DialogTitle>
          <DialogDescription>
            Create a focused page for a domain or IP. Its first evidence snapshot is captured automatically.
          </DialogDescription>
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
          <div className="space-y-2">
            <Label htmlFor="research-parent">Parent page</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger id="research-parent" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>No parent (top level)</SelectItem>
                {pages.map((page) => <SelectItem key={page.id} value={page.id}>{page.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border bg-muted/35 p-3 text-xs leading-5 text-muted-foreground">
            The first run checks DNS, lab inventory, recent logs, and SecurityTrails. Censys stays optional so credits are only used when you request a host profile.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={busy || !subject.trim()}
            onClick={() => onCreate({ subject, ...(title.trim() ? { title } : {}), parentId: parentId === NO_PARENT ? null : parentId })}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Create &amp; research
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [initialSubject, setInitialSubject] = useState("");
  const [newParentId, setNewParentId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("");
  const [parentId, setParentId] = useState(NO_PARENT);
  const [hours, setHours] = useState("24");
  const [pageSearch, setPageSearch] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const draftPageId = useRef<string | null>(null);

  const pagesQuery = useQuery({ queryKey: RESEARCH_QUERY_KEY, queryFn: () => apiFetch<ResearchPage[]>("/api/security/research") });
  const pages = useMemo(() => pagesQuery.data ?? [], [pagesQuery.data]);
  const activePage = pages.find((page) => page.id === activeId) ?? pages[0] ?? null;
  const tree = useMemo(() => buildResearchTree(pages), [pages]);
  const visibleTree = useMemo(() => filterResearchTree(tree, pageSearch), [pageSearch, tree]);
  const crumbs = useMemo(() => activePage ? researchAncestorChain(activePage, pages) : [], [activePage, pages]);
  const evidenceRuns = useMemo(() => groupResearchEvidence(activePage?.evidence ?? []), [activePage?.evidence]);
  const visibleRuns = selectedRunId ? evidenceRuns.filter((run) => run.runId === selectedRunId) : evidenceRuns;
  const blockedParentIds = useMemo(() => activePage ? researchDescendantIds(activePage.id, pages) : new Set<string>(), [activePage, pages]);
  const parentOptions = activePage ? pages.filter((page) => page.id !== activePage.id && !blockedParentIds.has(page.id)) : pages;

  useEffect(() => {
    if (activePage && draftPageId.current !== activePage.id) {
      draftPageId.current = activePage.id;
      setNotes(activePage.notes ?? "");
      setTitle(activePage.title);
      setParentId(activePage.parentId ?? NO_PARENT);
      setSelectedRunId(null);
      setEditing(false);
    }
  }, [activePage]);

  useEffect(() => {
    const subject = new URLSearchParams(window.location.search).get("subject")?.trim();
    if (subject) {
      setInitialSubject(subject);
      setNewParentId(null);
      setNewOpen(true);
    }
  }, []);

  const openNewPage = (parent: string | null = null) => {
    setInitialSubject("");
    setNewParentId(parent);
    setNewOpen(true);
  };

  const replacePage = (updated: ResearchPage) => {
    queryClient.setQueryData<ResearchPage[]>(RESEARCH_QUERY_KEY, (current = []) =>
      current.map((page) => page.id === updated.id ? updated : page));
  };

  const collectMutation = useMutation({
    mutationFn: ({ id, selectedHours = 24, providers }: { id: string; selectedHours?: number; providers?: string[] }) => apiFetch<ResearchPage>(`/api/security/research/${id}/collect`, {
      method: "POST", body: JSON.stringify({ hours: selectedHours, ...(providers ? { providers } : {}) }),
    }),
    onSuccess: (page, variables) => {
      replacePage(page);
      setSelectedRunId(null);
      toast.success(variables.providers?.includes("censys") ? "Censys evidence captured." : "Evidence run captured.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createMutation = useMutation({
    mutationFn: async (input: { subject: string; title?: string; parentId: string | null }) => {
      const page = await apiFetch<ResearchPage>("/api/security/research", { method: "POST", body: JSON.stringify(input) });
      queryClient.setQueryData<ResearchPage[]>(RESEARCH_QUERY_KEY, (current = []) => [page, ...current]);
      setActiveId(page.id);
      setNewOpen(false);
      return apiFetch<ResearchPage>(`/api/security/research/${page.id}/collect`, { method: "POST", body: JSON.stringify({ hours: 24 }) });
    },
    onSuccess: (page) => { replacePage(page); toast.success("Research page created with its first evidence run."); },
    onError: (error: Error) => toast.error(error.message),
  });

  const quickUpdateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<ResearchPage, "verdict" | "status">> }) =>
      apiFetch<ResearchPage>(`/api/security/research/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: replacePage,
    onError: (error: Error) => toast.error(error.message),
  });

  const saveMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Pick<ResearchPage, "title" | "notes" | "parentId"> }) =>
      apiFetch<ResearchPage>(`/api/security/research/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: (page) => {
      replacePage(page);
      setEditing(false);
      toast.success("Research page saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: true }>(`/api/security/research/${id}`, { method: "DELETE" }),
    onSuccess: (_result, deletedId) => {
      queryClient.setQueryData<ResearchPage[]>(RESEARCH_QUERY_KEY, (current = []) => current.filter((page) => page.id !== deletedId));
      setActiveId(null);
      setDeleteOpen(false);
      toast.success("Research page deleted.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const hasUnsavedChanges = Boolean(activePage && (
    notes !== (activePage.notes ?? "") || title.trim() !== activePage.title || (parentId === NO_PARENT ? null : parentId) !== activePage.parentId
  ));

  const selectPage = (id: string) => {
    if (id === activePage?.id) return;
    if (editing && hasUnsavedChanges) {
      toast.error("Save or cancel your edits before opening another page.");
      return;
    }
    setActiveId(id);
  };

  const cancelEditing = () => {
    if (!activePage) return;
    setNotes(activePage.notes ?? "");
    setTitle(activePage.title);
    setParentId(activePage.parentId ?? NO_PARENT);
    setEditing(false);
  };

  const saveActivePage = () => {
    if (!activePage || !title.trim() || saveMutation.isPending || !hasUnsavedChanges) return;
    const cleanTitle = title.trim();
    setTitle(cleanTitle);
    saveMutation.mutate({ id: activePage.id, patch: { title: cleanTitle, notes, parentId: parentId === NO_PARENT ? null : parentId } });
  };

  const insertEvidenceReference = (evidence: ResearchEvidence, embed: boolean) => {
    const token = `${embed ? "!" : ""}[[evidence:${evidence.id}|${evidence.title}]]`;
    setEditing(true);
    setNotes((current) => `${current}${current.trim() ? "\n\n" : ""}${token}`);
    toast.success(embed ? "Evidence card added to the draft." : "Evidence citation added to the draft.");
  };

  return (
    <>
      <PageHeader
        title="Research"
        description="Investigation pages, organized like your documentation and backed by immutable evidence."
        actions={<Button onClick={() => openNewPage()}><Plus className="size-4" /> New page</Button>}
      />

      {pagesQuery.isLoading ? (
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]"><Skeleton className="h-[650px]" /><Skeleton className="h-[650px]" /></div>
      ) : pagesQuery.isError ? (
        <EmptyState icon={CircleAlert} title="Could not open research" description={(pagesQuery.error as Error).message} />
      ) : pages.length === 0 ? (
        <Card className="overflow-hidden border-dashed">
          <CardContent className="flex min-h-[430px] flex-col items-center justify-center bg-[radial-gradient(circle_at_center,var(--color-muted)_0,transparent_68%)] text-center">
            <div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"><BookOpen className="size-8" /></div>
            <h2 className="text-xl font-semibold">Start your research library</h2>
            <p className="mt-2 max-w-lg text-sm text-muted-foreground">Create a page for a domain or IP, write in Markdown, and cite timestamped evidence without losing the original provider result.</p>
            <Button className="mt-5" onClick={() => openNewPage()}><Plus className="size-4" /> Create the first page</Button>
          </CardContent>
        </Card>
      ) : activePage ? (
        <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Card className="gap-3 overflow-hidden lg:sticky lg:top-4 lg:max-h-[calc(100svh-7rem)]">
            <CardHeader className="gap-3 border-b pb-4">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-sm"><FolderTree className="size-4 text-primary" /> All pages</CardTitle>
                <Badge variant="secondary">{pages.filter((page) => page.status === "open").length} open</Badge>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={pageSearch} onChange={(event) => setPageSearch(event.target.value)} placeholder="Find a page…" className="h-8 pl-8" />
              </div>
            </CardHeader>
            <ScrollArea className="min-h-48 lg:flex-1">
              <CardContent className="px-3">
                {visibleTree.length > 0 ? (
                  <ResearchTree nodes={visibleTree} activeId={activePage.id} onSelect={selectPage} />
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">No pages match “{pageSearch}”.</p>
                )}
              </CardContent>
            </ScrollArea>
            <div className="border-t p-3">
              <Button variant="outline" className="w-full" onClick={() => openNewPage()}><Plus className="size-4" /> New top-level page</Button>
            </div>
          </Card>

          <main className="min-w-0">
            <Breadcrumb className="mb-4">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <span>Research</span>
                </BreadcrumbItem>
                {crumbs.map((crumb) => (
                  <Fragment key={crumb.id}>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <button type="button" onClick={() => selectPage(crumb.id)} className="max-w-48 truncate transition-colors hover:text-foreground">{crumb.title}</button>
                    </BreadcrumbItem>
                  </Fragment>
                ))}
                <BreadcrumbSeparator />
                <BreadcrumbItem><BreadcrumbPage className="max-w-64 truncate">{activePage.title}</BreadcrumbPage></BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>

            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <Card className="min-w-0 overflow-hidden">
                <CardHeader className="gap-4 border-b">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="uppercase">{activePage.subjectType}</Badge>
                        <Badge variant="outline" className={verdictMeta[activePage.verdict].className}>{verdictMeta[activePage.verdict].label}</Badge>
                        {activePage.status === "archived" && <Badge variant="outline"><Archive className="size-3" /> Archived</Badge>}
                      </div>
                      {editing ? (
                        <div className="space-y-1.5">
                          <Label htmlFor="research-edit-title" className="sr-only">Page title</Label>
                          <Input id="research-edit-title" value={title} onChange={(event) => setTitle(event.target.value)} className="h-auto border-0 bg-transparent px-0 text-2xl font-semibold shadow-none focus-visible:ring-0" />
                        </div>
                      ) : (
                        <h1 className="text-2xl font-semibold tracking-tight">{activePage.title}</h1>
                      )}
                      <p className="mt-2 break-all font-mono text-sm text-primary">{activePage.subject}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => openNewPage(activePage.id)}><Plus className="size-4" /> Child page</Button>
                      {!editing && <Button size="sm" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">Assessment</Label>
                      <Select
                        value={activePage.verdict}
                        onValueChange={(verdict: ResearchPage["verdict"]) => quickUpdateMutation.mutate({ id: activePage.id, patch: { verdict } })}
                      >
                        <SelectTrigger className="mt-2 w-full bg-background"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unknown">Unknown</SelectItem>
                          <SelectItem value="benign">Benign</SelectItem>
                          <SelectItem value="suspicious">Suspicious</SelectItem>
                          <SelectItem value="malicious">Malicious</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last evidence run</p>
                      <p className="mt-2 flex items-start gap-2 text-sm"><CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> {displayResearchDate(activePage.lastResearchedAt)}</p>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="pt-1">
                  {editing ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_260px]">
                        <div>
                          <p className="text-sm font-medium">Investigation document</p>
                          <p className="text-xs text-muted-foreground">Full Markdown editor with live evidence references</p>
                          <a href="#research-evidence-panel" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline xl:hidden">
                            <FileSearch className="size-3" /> Open evidence ({activePage.evidence.length})
                          </a>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="research-edit-parent">Parent page</Label>
                          <Select value={parentId} onValueChange={setParentId}>
                            <SelectTrigger id="research-edit-parent" className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_PARENT}>No parent (top level)</SelectItem>
                              {parentOptions.map((page) => <SelectItem key={page.id} value={page.id}>{page.title}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <ResearchEvidenceEditor value={notes} onChange={setNotes} evidence={activePage.evidence} onSave={saveActivePage} />
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className={cn("text-xs", hasUnsavedChanges ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                          {hasUnsavedChanges ? "Unsaved changes" : "No changes yet"} · {notes.length.toLocaleString()} characters
                        </p>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={cancelEditing}><X className="size-4" /> Cancel</Button>
                          <Button size="sm" disabled={saveMutation.isPending || !title.trim() || !hasUnsavedChanges} onClick={saveActivePage}>
                            {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save page
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : activePage.notes?.trim() ? (
                    <Markdown content={expandEvidenceReferences(activePage.notes, activePage.evidence)} />
                  ) : (
                    <button type="button" onClick={() => setEditing(true)} className="flex min-h-56 w-full flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center hover:bg-muted/25">
                      <Pencil className="mb-3 size-7 text-muted-foreground" />
                      <span className="font-medium">Write the investigation</span>
                      <span className="mt-1 max-w-sm text-sm text-muted-foreground">Add hypotheses, findings, decisions, and citations with the full Markdown editor.</span>
                    </button>
                  )}
                </CardContent>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/15 px-5 py-3 text-xs text-muted-foreground">
                  <span>Created by {activePage.createdBy?.displayName || activePage.createdBy?.username || "a former user"} · {displayResearchDate(activePage.createdAt)}</span>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="xs" onClick={() => quickUpdateMutation.mutate({ id: activePage.id, patch: { status: activePage.status === "open" ? "archived" : "open" } })}>
                      {activePage.status === "open" ? <Archive className="size-3" /> : <BookOpen className="size-3" />} {activePage.status === "open" ? "Archive" : "Reopen"}
                    </Button>
                    <Button variant="ghost" size="xs" className="text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}><Trash2 className="size-3" /> Delete</Button>
                  </div>
                </div>
              </Card>

              <Card id="research-evidence-panel" className="gap-3 overflow-hidden xl:sticky xl:top-4 xl:max-h-[calc(100svh-7rem)]">
                <CardHeader className="gap-3 border-b pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-sm">Evidence</CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">Available beside the editor for citations and embeds.</p>
                    </div>
                    <Badge variant="secondary">{activePage.evidence.length}</Badge>
                  </div>
                  <div className="flex gap-2">
                    <Select value={hours} onValueChange={setHours}>
                      <SelectTrigger className="min-w-0 flex-1 bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="1">Last hour</SelectItem><SelectItem value="24">Last 24h</SelectItem><SelectItem value="168">Last 7d</SelectItem></SelectContent>
                    </Select>
                    <Button size="icon" disabled={collectMutation.isPending} aria-label="Run research now" title="Run research now" onClick={() => collectMutation.mutate({ id: activePage.id, selectedHours: Number(hours) })}>
                      {collectMutation.isPending && !collectMutation.variables?.providers ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    </Button>
                  </div>
                  <Button variant="outline" size="sm" className="w-full" disabled={collectMutation.isPending} onClick={() => setCensysOpen(true)}>
                    {collectMutation.isPending && collectMutation.variables?.providers?.includes("censys") ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Censys host &amp; services
                  </Button>
                  {evidenceRuns.length > 1 && (
                    <Select value={selectedRunId ?? "__all__"} onValueChange={(value) => setSelectedRunId(value === "__all__" ? null : value)}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All evidence · {evidenceRuns.length} runs</SelectItem>
                        {evidenceRuns.map((run, index) => (
                          <SelectItem key={run.runId} value={run.runId}>{index === 0 ? "Latest" : `Run ${evidenceRuns.length - index}`} · {displayShortDate(run.capturedAt)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </CardHeader>
                <ScrollArea className="min-h-72 xl:flex-1">
                  <CardContent className="space-y-2 px-3">
                    {visibleRuns.length === 0 ? (
                      <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed p-5 text-center">
                        <ShieldQuestion className="mb-3 size-7 text-muted-foreground" />
                        <p className="text-sm font-medium">No evidence yet</p>
                        <p className="mt-1 text-xs text-muted-foreground">Run research to capture the first snapshot.</p>
                      </div>
                    ) : (
                      visibleRuns.map((run, index) => (
                        <section key={run.runId} className={cn("space-y-2", index > 0 && "border-t pt-3")}>
                          <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
                            <Check className="size-3 text-emerald-600" />
                            {displayResearchDate(run.capturedAt)} · {run.items.filter((item) => item.status === "success").length}/{run.items.length} captured
                          </div>
                          {run.items.map((item) => <EvidenceCard key={item.id} evidence={item} onInsert={insertEvidenceReference} />)}
                        </section>
                      ))
                    )}
                  </CardContent>
                </ScrollArea>
              </Card>
            </div>
          </main>
        </div>
      ) : null}

      <NewResearchDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        busy={createMutation.isPending}
        initialSubject={initialSubject}
        initialParentId={newParentId}
        pages={pages}
        onCreate={(input) => createMutation.mutate(input)}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{activePage?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the page, its Markdown, and every captured evidence run. Any child pages will move to the top level.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Keep page</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={!activePage || deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (activePage) deleteMutation.mutate(activePage.id);
              }}
            >
              {deleteMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Delete page and evidence
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={censysOpen} onOpenChange={setCensysOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Load Censys host and services?</DialogTitle>
            <DialogDescription>PolySIEM checks its four-day cache first. A cache hit costs nothing; otherwise Censys uses one provider credit for each host profile returned.</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-sm text-amber-900 dark:text-amber-100">
            <div className="flex gap-2"><Coins className="mt-0.5 size-4 shrink-0" /><p>{activePage?.subjectType === "domain" ? "This domain can resolve to as many as four hosts, so a fully uncached lookup may use up to four Censys credits." : "An uncached lookup for this IP should use one Censys credit."} The result includes ownership, DNS names, location, ports, protocols, and detected software when available.</p></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCensysOpen(false)}>Cancel</Button>
            <Button disabled={!activePage || collectMutation.isPending} onClick={() => {
              if (!activePage) return;
              setCensysOpen(false);
              collectMutation.mutate({ id: activePage.id, providers: ["censys"] });
            }}>
              <Search className="size-4" /> Load host &amp; services
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
