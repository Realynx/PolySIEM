"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

function ResearchRootContent({ loading, error, pages, activePage, onCreate, workspace }: { loading: boolean; error: Error | null; pages: ResearchPage[]; activePage: ResearchPage | null; onCreate: () => void; workspace: ReactNode }) {
  if (loading) return <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]"><Skeleton className="h-[650px]" /><Skeleton className="h-[650px]" /></div>;
  if (error) return <EmptyState icon={CircleAlert} title="Could not open research" description={error.message} />;
  if (pages.length === 0) return <Card className="overflow-hidden border-dashed"><CardContent className="flex min-h-[430px] flex-col items-center justify-center bg-[radial-gradient(circle_at_center,var(--color-muted)_0,transparent_68%)] text-center"><div className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"><BookOpen className="size-8" /></div><h2 className="text-xl font-semibold">Start your research library</h2><p className="mt-2 max-w-lg text-sm text-muted-foreground">Create a page for a domain or IP, write in Markdown, and cite timestamped evidence without losing the original provider result.</p><Button className="mt-5" onClick={onCreate}><Plus className="size-4" /> Create the first page</Button></CardContent></Card>;
  return activePage ? workspace : null;
}

function ResearchSidebar({ pages, visibleTree, activePage, search, setSearch, onSelect, onCreate }: { pages: ResearchPage[]; visibleTree: ResearchTreeNode[]; activePage: ResearchPage; search: string; setSearch: (value: string) => void; onSelect: (id: string) => void; onCreate: () => void }) {
  return <Card className="gap-3 overflow-hidden lg:sticky lg:top-4 lg:max-h-[calc(100svh-7rem)]"><CardHeader className="gap-3 border-b pb-4"><div className="flex items-center justify-between gap-2"><CardTitle className="flex items-center gap-2 text-sm"><FolderTree className="size-4 text-primary" /> All pages</CardTitle><Badge variant="secondary">{pages.filter((page) => page.status === "open").length} open</Badge></div><div className="relative"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a page…" className="h-8 pl-8" /></div></CardHeader><ScrollArea className="min-h-48 lg:flex-1"><CardContent className="px-3">{visibleTree.length > 0 ? <ResearchTree nodes={visibleTree} activeId={activePage.id} onSelect={onSelect} /> : <p className="py-8 text-center text-sm text-muted-foreground">No pages match “{search}”.</p>}</CardContent></ScrollArea><div className="border-t p-3"><Button variant="outline" className="w-full" onClick={onCreate}><Plus className="size-4" /> New top-level page</Button></div></Card>;
}

function ResearchBreadcrumbs({ crumbs, page, onSelect }: { crumbs: ResearchPage[]; page: ResearchPage; onSelect: (id: string) => void }) {
  return <Breadcrumb className="mb-4"><BreadcrumbList><BreadcrumbItem><span>Research</span></BreadcrumbItem>{crumbs.map((crumb) => <Fragment key={crumb.id}><BreadcrumbSeparator /><BreadcrumbItem><button type="button" onClick={() => onSelect(crumb.id)} className="max-w-48 truncate transition-colors hover:text-foreground">{crumb.title}</button></BreadcrumbItem></Fragment>)}<BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage className="max-w-64 truncate">{page.title}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>;
}

function ResearchDocumentHeader({ page, editing, title, setTitle, onChild, onEdit, onVerdict }: { page: ResearchPage; editing: boolean; title: string; setTitle: (value: string) => void; onChild: () => void; onEdit: () => void; onVerdict: (verdict: ResearchPage["verdict"]) => void }) {
  return <CardHeader className="gap-4 border-b"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-2"><Badge variant="outline" className="uppercase">{page.subjectType}</Badge><Badge variant="outline" className={verdictMeta[page.verdict].className}>{verdictMeta[page.verdict].label}</Badge>{page.status === "archived" && <Badge variant="outline"><Archive className="size-3" /> Archived</Badge>}</div>{editing ? <div className="space-y-1.5"><Label htmlFor="research-edit-title" className="sr-only">Page title</Label><Input id="research-edit-title" value={title} onChange={(event) => setTitle(event.target.value)} className="h-auto border-0 bg-transparent px-0 text-2xl font-semibold shadow-none focus-visible:ring-0" /></div> : <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>}<p className="mt-2 break-all font-mono text-sm text-primary">{page.subject}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={onChild}><Plus className="size-4" /> Child page</Button>{!editing && <Button size="sm" onClick={onEdit}><Pencil className="size-4" /> Edit</Button>}</div></div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border bg-muted/20 p-3"><Label className="text-xs uppercase tracking-wide text-muted-foreground">Assessment</Label><Select value={page.verdict} onValueChange={onVerdict}><SelectTrigger className="mt-2 w-full bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">Unknown</SelectItem><SelectItem value="benign">Benign</SelectItem><SelectItem value="suspicious">Suspicious</SelectItem><SelectItem value="malicious">Malicious</SelectItem></SelectContent></Select></div><div className="rounded-lg border bg-muted/20 p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last evidence run</p><p className="mt-2 flex items-start gap-2 text-sm"><CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> {displayResearchDate(page.lastResearchedAt)}</p></div></div></CardHeader>;
}

function ResearchDocumentBody({ page, editing, parentId, setParentId, parentOptions, notes, setNotes, hasChanges, savePending, title, onSave, onCancel, onEdit }: { page: ResearchPage; editing: boolean; parentId: string; setParentId: (value: string) => void; parentOptions: ResearchPage[]; notes: string; setNotes: (value: string) => void; hasChanges: boolean; savePending: boolean; title: string; onSave: () => void; onCancel: () => void; onEdit: () => void }) {
  if (!editing) return <CardContent className="pt-1">{page.notes?.trim() ? <Markdown content={expandEvidenceReferences(page.notes, page.evidence)} /> : <button type="button" onClick={onEdit} className="flex min-h-56 w-full flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center hover:bg-muted/25"><Pencil className="mb-3 size-7 text-muted-foreground" /><span className="font-medium">Write the investigation</span><span className="mt-1 max-w-sm text-sm text-muted-foreground">Add hypotheses, findings, decisions, and citations with the full Markdown editor.</span></button>}</CardContent>;
  return <CardContent className="pt-1"><div className="space-y-4"><div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_260px]"><div><p className="text-sm font-medium">Investigation document</p><p className="text-xs text-muted-foreground">Full Markdown editor with live evidence references</p><a href="#research-evidence-panel" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline xl:hidden"><FileSearch className="size-3" /> Open evidence ({page.evidence.length})</a></div><div className="space-y-1.5"><Label htmlFor="research-edit-parent">Parent page</Label><Select value={parentId} onValueChange={setParentId}><SelectTrigger id="research-edit-parent" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={NO_PARENT}>No parent (top level)</SelectItem>{parentOptions.map((option) => <SelectItem key={option.id} value={option.id}>{option.title}</SelectItem>)}</SelectContent></Select></div></div><ResearchEvidenceEditor value={notes} onChange={setNotes} evidence={page.evidence} onSave={onSave} /><div className="flex flex-wrap items-center justify-between gap-3"><p className={cn("text-xs", hasChanges ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{hasChanges ? "Unsaved changes" : "No changes yet"} · {notes.length.toLocaleString()} characters</p><div className="flex gap-2"><Button variant="outline" size="sm" onClick={onCancel}><X className="size-4" /> Cancel</Button><Button size="sm" disabled={savePending || !title.trim() || !hasChanges} onClick={onSave}>{savePending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save page</Button></div></div></div></CardContent>;
}

function ResearchDocument({ page, header, body, onToggleArchive, onDelete }: { page: ResearchPage; header: ReactNode; body: ReactNode; onToggleArchive: () => void; onDelete: () => void }) {
  const creator = page.createdBy?.displayName || page.createdBy?.username || "a former user";
  return <Card className="min-w-0 overflow-hidden">{header}{body}<div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/15 px-5 py-3 text-xs text-muted-foreground"><span>Created by {creator} · {displayResearchDate(page.createdAt)}</span><div className="flex gap-1"><Button variant="ghost" size="xs" onClick={onToggleArchive}>{page.status === "open" ? <Archive className="size-3" /> : <BookOpen className="size-3" />} {page.status === "open" ? "Archive" : "Reopen"}</Button><Button variant="ghost" size="xs" className="text-destructive hover:text-destructive" onClick={onDelete}><Trash2 className="size-3" /> Delete</Button></div></div></Card>;
}

type DesktopEvidenceRun = ReturnType<typeof groupResearchEvidence>[number];

function ResearchEvidencePanel({ page, hours, setHours, collectPending, collectingCensys, onCollect, onCensys, runs, visibleRuns, selectedRunId, setSelectedRunId, onInsert }: { page: ResearchPage; hours: string; setHours: (value: string) => void; collectPending: boolean; collectingCensys: boolean; onCollect: () => void; onCensys: () => void; runs: DesktopEvidenceRun[]; visibleRuns: DesktopEvidenceRun[]; selectedRunId: string | null; setSelectedRunId: (value: string | null) => void; onInsert: (evidence: ResearchEvidence, embed: boolean) => void }) {
  return <Card id="research-evidence-panel" className="gap-3 overflow-hidden xl:sticky xl:top-4 xl:max-h-[calc(100svh-7rem)]"><CardHeader className="gap-3 border-b pb-4"><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-sm">Evidence</CardTitle><p className="mt-1 text-xs text-muted-foreground">Available beside the editor for citations and embeds.</p></div><Badge variant="secondary">{page.evidence.length}</Badge></div><div className="flex gap-2"><Select value={hours} onValueChange={setHours}><SelectTrigger className="min-w-0 flex-1 bg-background"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Last hour</SelectItem><SelectItem value="24">Last 24h</SelectItem><SelectItem value="168">Last 7d</SelectItem></SelectContent></Select><Button size="icon" disabled={collectPending} aria-label="Run research now" title="Run research now" onClick={onCollect}>{collectPending && !collectingCensys ? <Loader2 className="animate-spin" /> : <RefreshCw />}</Button></div><Button variant="outline" size="sm" className="w-full" disabled={collectPending} onClick={onCensys}>{collectingCensys ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Censys host &amp; services</Button>{runs.length > 1 && <Select value={selectedRunId ?? "__all__"} onValueChange={(value) => setSelectedRunId(value === "__all__" ? null : value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__all__">All evidence · {runs.length} runs</SelectItem>{runs.map((run, index) => <SelectItem key={run.runId} value={run.runId}>{index === 0 ? "Latest" : `Run ${runs.length - index}`} · {displayShortDate(run.capturedAt)}</SelectItem>)}</SelectContent></Select>}</CardHeader><ScrollArea className="min-h-72 xl:flex-1"><CardContent className="space-y-2 px-3">{visibleRuns.length === 0 ? <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed p-5 text-center"><ShieldQuestion className="mb-3 size-7 text-muted-foreground" /><p className="text-sm font-medium">No evidence yet</p><p className="mt-1 text-xs text-muted-foreground">Run research to capture the first snapshot.</p></div> : visibleRuns.map((run, index) => <section key={run.runId} className={cn("space-y-2", index > 0 && "border-t pt-3")}><div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground"><Check className="size-3 text-emerald-600" />{displayResearchDate(run.capturedAt)} · {run.items.filter((item) => item.status === "success").length}/{run.items.length} captured</div>{run.items.map((item) => <EvidenceCard key={item.id} evidence={item} onInsert={onInsert} />)}</section>)}</CardContent></ScrollArea></Card>;
}

function ResearchWorkspace({ sidebar, breadcrumbs, document, evidence }: { sidebar: ReactNode; breadcrumbs: ReactNode; document: ReactNode; evidence: ReactNode }) {
  return <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">{sidebar}<main className="min-w-0">{breadcrumbs}<div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">{document}{evidence}</div></main></div>;
}

function DeleteResearchDialog({ open, setOpen, page, busy, onDelete }: { open: boolean; setOpen: (open: boolean) => void; page: ResearchPage | null; busy: boolean; onDelete: () => void }) {
  return <AlertDialog open={open} onOpenChange={setOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete “{page?.title}”?</AlertDialogTitle><AlertDialogDescription>This permanently removes the page, its Markdown, and every captured evidence run. Any child pages will move to the top level.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Keep page</AlertDialogCancel><AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" disabled={!page || busy} onClick={(event) => { event.preventDefault(); onDelete(); }}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}Delete page and evidence</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

function CensysResearchDialog({ open, setOpen, page, busy, onLoad }: { open: boolean; setOpen: (open: boolean) => void; page: ResearchPage | null; busy: boolean; onLoad: () => void }) {
  const message = page?.subjectType === "domain" ? "This domain can resolve to as many as four hosts, so a fully uncached lookup may use up to four Censys credits." : "An uncached lookup for this IP should use one Censys credit.";
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Load Censys host and services?</DialogTitle><DialogDescription>PolySIEM checks its four-day cache first. A cache hit costs nothing; otherwise Censys uses one provider credit for each host profile returned.</DialogDescription></DialogHeader><div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-sm text-amber-900 dark:text-amber-100"><div className="flex gap-2"><Coins className="mt-0.5 size-4 shrink-0" /><p>{message} The result includes ownership, DNS names, location, ports, protocols, and detected software when available.</p></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!page || busy} onClick={onLoad}><Search className="size-4" /> Load host &amp; services</Button></DialogFooter></DialogContent></Dialog>;
}

function desktopDraftChanged(page: ResearchPage | null, notes: string, title: string, parentId: string) {
  return Boolean(page && (notes !== (page.notes ?? "") || title.trim() !== page.title || (parentId === NO_PARENT ? null : parentId) !== page.parentId));
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

  const hasUnsavedChanges = desktopDraftChanged(activePage, notes, title, parentId);

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

  const collectingCensys = Boolean(collectMutation.isPending && collectMutation.variables?.providers?.includes("censys"));
  const workspace = activePage ? (
    <ResearchWorkspace
      sidebar={<ResearchSidebar pages={pages} visibleTree={visibleTree} activePage={activePage} search={pageSearch} setSearch={setPageSearch} onSelect={selectPage} onCreate={() => openNewPage()} />}
      breadcrumbs={<ResearchBreadcrumbs crumbs={crumbs} page={activePage} onSelect={selectPage} />}
      document={<ResearchDocument page={activePage} header={<ResearchDocumentHeader page={activePage} editing={editing} title={title} setTitle={setTitle} onChild={() => openNewPage(activePage.id)} onEdit={() => setEditing(true)} onVerdict={(verdict) => quickUpdateMutation.mutate({ id: activePage.id, patch: { verdict } })} />} body={<ResearchDocumentBody page={activePage} editing={editing} parentId={parentId} setParentId={setParentId} parentOptions={parentOptions} notes={notes} setNotes={setNotes} hasChanges={hasUnsavedChanges} savePending={saveMutation.isPending} title={title} onSave={saveActivePage} onCancel={cancelEditing} onEdit={() => setEditing(true)} />} onToggleArchive={() => quickUpdateMutation.mutate({ id: activePage.id, patch: { status: activePage.status === "open" ? "archived" : "open" } })} onDelete={() => setDeleteOpen(true)} />}
      evidence={<ResearchEvidencePanel page={activePage} hours={hours} setHours={setHours} collectPending={collectMutation.isPending} collectingCensys={collectingCensys} onCollect={() => collectMutation.mutate({ id: activePage.id, selectedHours: Number(hours) })} onCensys={() => setCensysOpen(true)} runs={evidenceRuns} visibleRuns={visibleRuns} selectedRunId={selectedRunId} setSelectedRunId={setSelectedRunId} onInsert={insertEvidenceReference} />}
    />
  ) : null;

  return (
    <>
      <PageHeader title="Research" description="Investigation pages, organized like your documentation and backed by immutable evidence." actions={<Button onClick={() => openNewPage()}><Plus className="size-4" /> New page</Button>} />
      <ResearchRootContent loading={pagesQuery.isLoading} error={pagesQuery.isError ? pagesQuery.error as Error : null} pages={pages} activePage={activePage} onCreate={() => openNewPage()} workspace={workspace} />
      <NewResearchDialog open={newOpen} onOpenChange={setNewOpen} busy={createMutation.isPending} initialSubject={initialSubject} initialParentId={newParentId} pages={pages} onCreate={(input) => createMutation.mutate(input)} />
      <DeleteResearchDialog open={deleteOpen} setOpen={setDeleteOpen} page={activePage} busy={deleteMutation.isPending} onDelete={() => { if (activePage) deleteMutation.mutate(activePage.id); }} />
      <CensysResearchDialog open={censysOpen} setOpen={setCensysOpen} page={activePage} busy={collectMutation.isPending} onLoad={() => { if (!activePage) return; setCensysOpen(false); collectMutation.mutate({ id: activePage.id, providers: ["censys"] }); }} />
    </>
  );
}
