"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BookOpen,
  Check,
  ChevronLeft,
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
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { ResearchEvidenceEditor } from "@/components/security/research-evidence-editor";
import {
  RESEARCH_QUERY_KEY,
  displayResearchDate,
  flattenResearchTree,
  groupResearchEvidence,
  type ResearchEvidence,
  type ResearchPage,
} from "@/components/security/research-notebook-model";
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
import { Button } from "@/components/ui/button";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileFab } from "@/components/mobile/ui/mobile-fab";

const PROVIDER_META: Record<string, { label: string; icon: typeof Globe2; className: string }> = {
  dns: { label: "DNS", icon: Globe2, className: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  polysiem: { label: "PolySIEM", icon: Network, className: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  elasticsearch: { label: "Logs", icon: Database, className: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  censys: { label: "Censys", icon: Search, className: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" },
  securitytrails: { label: "SecurityTrails", icon: FileSearch, className: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" },
};

const VERDICT_STYLES: Record<ResearchPage["verdict"], string> = {
  unknown: "border-border bg-muted text-muted-foreground",
  benign: "border-success/40 bg-success/10 text-success",
  suspicious: "border-warning/40 bg-warning/10 text-warning",
  malicious: "border-destructive/40 bg-destructive/10 text-destructive",
};

/**
 * Phone research notebook: page index as touch rows, one page open at a time
 * with verdict, notes, and the dated evidence trail. Mirrors the desktop
 * notebook's structure compactly; ?subject= deep links open the new-page form.
 */
export function MobileResearchNotebook() {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [censysOpen, setCensysOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [initialSubject, setInitialSubject] = useState("");
  const [newParentId, setNewParentId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("");
  const [hours, setHours] = useState("24");

  const pagesQuery = useQuery({
    queryKey: RESEARCH_QUERY_KEY,
    queryFn: () => apiFetch<ResearchPage[]>("/api/security/research"),
  });
  const pages = useMemo(() => pagesQuery.data ?? [], [pagesQuery.data]);
  const orderedPages = useMemo(() => flattenResearchTree(pages), [pages]);
  // Unlike desktop (sidebar + page), the phone shows the index until a page is picked.
  const activePage = activeId !== null ? (pages.find((page) => page.id === activeId) ?? null) : null;

  useEffect(() => {
    if (activePage) {
      setNotes(activePage.notes ?? "");
      setTitle(activePage.title);
    }
  }, [activePage?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const subject = new URLSearchParams(window.location.search).get("subject")?.trim();
    if (subject) {
      setInitialSubject(subject);
      setNewOpen(true);
    }
  }, []);

  const openNewPage = () => {
    setInitialSubject("");
    setNewParentId(null);
    setNewOpen(true);
  };

  const replacePage = (updated: ResearchPage) => {
    queryClient.setQueryData<ResearchPage[]>(RESEARCH_QUERY_KEY, (current = []) =>
      current.map((page) => (page.id === updated.id ? updated : page)),
    );
  };

  const collectMutation = useMutation({
    mutationFn: ({ id, selectedHours = 24, providers }: { id: string; selectedHours?: number; providers?: string[] }) =>
      apiFetch<ResearchPage>(`/api/security/research/${id}/collect`, {
        method: "POST",
        body: JSON.stringify({ hours: selectedHours, ...(providers ? { providers } : {}) }),
      }),
    onSuccess: (page, variables) => {
      replacePage(page);
      toast.success(variables.providers?.includes("censys") ? "Censys evidence captured." : "Evidence run captured.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createMutation = useMutation({
    mutationFn: async (input: { subject: string; title?: string; parentId: string | null }) => {
      const page = await apiFetch<ResearchPage>("/api/security/research", {
        method: "POST",
        body: JSON.stringify(input),
      });
      queryClient.setQueryData<ResearchPage[]>(RESEARCH_QUERY_KEY, (current = []) => [page, ...current]);
      setActiveId(page.id);
      setNewOpen(false);
      return apiFetch<ResearchPage>(`/api/security/research/${page.id}/collect`, {
        method: "POST",
        body: JSON.stringify({ hours: 24 }),
      });
    },
    onSuccess: (page) => {
      replacePage(page);
      toast.success("Research page created with its first evidence run.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<ResearchPage, "title" | "notes" | "verdict" | "status">> }) =>
      apiFetch<ResearchPage>(`/api/security/research/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: (page) => {
      replacePage(page);
      toast.success("Research page saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: true }>(`/api/security/research/${id}`, { method: "DELETE" }),
    onSuccess: (_result, deletedId) => {
      queryClient.setQueryData<ResearchPage[]>(RESEARCH_QUERY_KEY, (current = []) =>
        current.filter((page) => page.id !== deletedId),
      );
      setActiveId(null);
      setDeleteOpen(false);
      toast.success("Research page deleted.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const evidenceRuns = useMemo(() => groupResearchEvidence(activePage?.evidence ?? []), [activePage?.evidence]);
  const hasUnsavedChanges = Boolean(activePage && (notes !== (activePage.notes ?? "") || title.trim() !== activePage.title));
  const saveActivePage = () => {
    if (!activePage || !title.trim() || updateMutation.isPending || !hasUnsavedChanges) return;
    const cleanTitle = title.trim();
    setTitle(cleanTitle);
    updateMutation.mutate({ id: activePage.id, patch: { title: cleanTitle, notes } });
  };

  return (
    <>
      <MobilePageHeader title={activePage ? activePage.title : "Research notebook"} />

      <MobilePage className="pb-6">
        {activePage && (
          <button
            type="button"
            onClick={() => setActiveId(null)}
            className="-mt-1 flex min-h-10 items-center gap-1 self-start px-0.5 text-[13px] font-medium text-muted-foreground active:text-foreground"
          >
            <ChevronLeft className="size-4" />
            All pages
          </button>
        )}
        {pagesQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-13 w-full rounded-xl" />
            ))}
          </div>
        ) : pagesQuery.isError ? (
          <MobileEmpty
            icon={<CircleAlert />}
            title="Could not open the research notebook"
            description={(pagesQuery.error as Error).message}
          />
        ) : activePage ? (
          <>
            {/* Page head: subject + badges + verdict */}
            <div className="space-y-2 px-0.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-[0.65rem] uppercase">
                  {activePage.subjectType}
                </Badge>
                <Badge variant={activePage.status === "open" ? "secondary" : "outline"} className="text-[0.65rem]">
                  {activePage.status}
                </Badge>
                <Badge variant="outline" className={cn("text-[0.65rem] uppercase", VERDICT_STYLES[activePage.verdict])}>
                  {activePage.verdict}
                </Badge>
              </div>
              <p className="font-mono text-sm break-all text-primary">{activePage.subject}</p>
              <p className="text-[11px] text-muted-foreground">
                Last evidence run: {displayResearchDate(activePage.lastResearchedAt)}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setInitialSubject("");
                  setNewParentId(activePage.id);
                  setNewOpen(true);
                }}
              >
                <Plus className="size-4" /> Add child page
              </Button>
            </div>

            <MobileSection title="Assessment">
              <Select
                value={activePage.verdict}
                onValueChange={(verdict: ResearchPage["verdict"]) =>
                  updateMutation.mutate({ id: activePage.id, patch: { verdict } })
                }
              >
                <SelectTrigger className="w-full bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">Unknown</SelectItem>
                  <SelectItem value="benign">Benign</SelectItem>
                  <SelectItem value="suspicious">Suspicious</SelectItem>
                  <SelectItem value="malicious">Malicious</SelectItem>
                </SelectContent>
              </Select>
            </MobileSection>

            <MobileSection title="Analyst notes">
              <div className="space-y-2">
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  aria-label="Research page title"
                  className="bg-card"
                />
                <ResearchEvidenceEditor value={notes} onChange={setNotes} evidence={activePage.evidence} onSave={saveActivePage} compact />
                <p className={cn("text-right text-[11px]", hasUnsavedChanges ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                  {hasUnsavedChanges ? "Unsaved changes" : "All changes saved"}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        updateMutation.mutate({
                          id: activePage.id,
                          patch: { status: activePage.status === "open" ? "archived" : "open" },
                        })
                      }
                    >
                      {activePage.status === "open" ? <Archive className="size-4" /> : <BookOpen className="size-4" />}
                      {activePage.status === "open" ? "Archive" : "Reopen"}
                    </Button>
                    <Button variant="destructive" size="icon-sm" aria-label="Delete page" onClick={() => setDeleteOpen(true)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    disabled={updateMutation.isPending || !title.trim() || !hasUnsavedChanges}
                    onClick={saveActivePage}
                  >
                    {updateMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    {hasUnsavedChanges ? "Save page" : "Saved"}
                  </Button>
                </div>
              </div>
            </MobileSection>

            <MobileSection title="Evidence trail">
              <div className="flex items-center gap-2">
                <Select value={hours} onValueChange={setHours}>
                  <SelectTrigger size="sm" className="w-26 shrink-0 bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Last hour</SelectItem>
                    <SelectItem value="24">Last 24h</SelectItem>
                    <SelectItem value="168">Last 7d</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-w-0 flex-1"
                  disabled={collectMutation.isPending}
                  onClick={() => setCensysOpen(true)}
                >
                  {collectMutation.isPending && collectMutation.variables?.providers?.includes("censys") ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Search className="size-3.5" />
                  )}
                  Censys
                </Button>
                <Button
                  size="sm"
                  className="min-w-0 flex-1"
                  disabled={collectMutation.isPending}
                  onClick={() => collectMutation.mutate({ id: activePage.id, selectedHours: Number(hours) })}
                >
                  {collectMutation.isPending && !collectMutation.variables?.providers ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Research now
                </Button>
              </div>

              {evidenceRuns.length === 0 ? (
                <MobileEmpty
                  icon={<ShieldQuestion />}
                  title="No evidence captured yet"
                  description="Run research to query every connected source without changing your notes."
                />
              ) : (
                <div className="space-y-4 pt-1">
                  {evidenceRuns.map((run, index) => (
                    <section key={run.runId}>
                      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                        <span
                          className={cn(
                            "flex size-4.5 shrink-0 items-center justify-center rounded-full",
                            index === 0 ? "bg-primary text-primary-foreground" : "bg-muted",
                          )}
                        >
                          {index === 0 ? <Check className="size-3" /> : evidenceRuns.length - index}
                        </span>
                        {displayResearchDate(run.capturedAt)} ·{" "}
                        {run.items.filter((item) => item.status === "success").length}/{run.items.length} sources
                      </div>
                      <div className="space-y-2 border-l pl-2.5">
                        {run.items.map((item) => (
                          <MobileEvidenceCard key={item.id} evidence={item} />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </MobileSection>

            <p className="px-0.5 text-[11px] text-muted-foreground">
              Opened by {activePage.createdBy?.displayName || activePage.createdBy?.username || "a former user"} on{" "}
              {displayResearchDate(activePage.createdAt)}.
            </p>
          </>
        ) : pages.length === 0 ? (
          <MobileEmpty
            icon={<BookOpen />}
            title="Your first investigation starts here"
            description="Create a page for an address from your logs. Evidence stays timestamped, so later research adds history instead of overwriting what you found."
            action={
              <Button size="sm" onClick={openNewPage}>
                <Plus className="size-4" /> Start researching
              </Button>
            }
          />
        ) : (
          <MobileSection title={`Pages · ${pages.filter((page) => page.status === "open").length} open`}>
            <MobileList>
              {orderedPages.map(({ page, depth }) => (
                <MobileListRow
                  key={page.id}
                  onClick={() => setActiveId(page.id)}
                  className={cn(depth > 0 && "border-l-2 border-l-primary/20", page.status === "archived" && "opacity-60")}
                  leading={depth > 0 ? <span className="text-[10px] font-medium text-muted-foreground">{depth}</span> : undefined}
                  title={
                    <>
                      <span className="min-w-0 truncate">{page.title}</span>
                      {page.verdict !== "unknown" && (
                        <Badge
                          variant="outline"
                          className={cn("shrink-0 px-1 text-[0.6rem] uppercase", VERDICT_STYLES[page.verdict])}
                        >
                          {page.verdict}
                        </Badge>
                      )}
                    </>
                  }
                  subtitle={<span className="font-mono">{page.subject}</span>}
                  trailing={<span>{page.evidence.length > 0 ? `${groupResearchEvidence(page.evidence).length} runs` : "new"}</span>}
                />
              ))}
            </MobileList>
          </MobileSection>
        )}
      </MobilePage>

      {!activePage && !pagesQuery.isLoading && !pagesQuery.isError && pages.length > 0 && (
        <MobileFab aria-label="New research page" onClick={openNewPage}>
          <Plus />
        </MobileFab>
      )}

      {/* New page dialog (mirrors the desktop NewResearchDialog; ui/dialog presents as a bottom sheet on phones). */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{newParentId ? "Add a child research page" : "Start a research page"}</DialogTitle>
            <DialogDescription>
              Enter the suspicious address exactly as it appeared. PolySIEM will preserve it and gather
              evidence from every available source.
            </DialogDescription>
          </DialogHeader>
          <NewResearchForm
            key={newOpen ? `${initialSubject}:${newParentId ?? "root"}` : "closed"}
            busy={createMutation.isPending}
            initialSubject={initialSubject}
            initialParentId={newParentId}
            pages={pages}
            onCancel={() => setNewOpen(false)}
            onCreate={(input) => createMutation.mutate(input)}
          />
        </DialogContent>
      </Dialog>

      {/* Censys credit confirmation (mirrors the desktop dialog). */}
      <Dialog open={censysOpen} onOpenChange={setCensysOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load Censys host and services?</DialogTitle>
            <DialogDescription>
              PolySIEM checks its four-day cache first. A cache hit costs nothing. Otherwise, Censys
              currently charges one provider credit for each host profile returned.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-sm text-amber-900 dark:text-amber-100">
            <div className="flex gap-2">
              <Coins className="mt-0.5 size-4 shrink-0" />
              <p>
                {activePage?.subjectType === "domain"
                  ? "This domain can resolve to as many as four hosts, so a fully uncached lookup may use up to four Censys credits."
                  : "An uncached lookup for this IP should use one Censys credit."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCensysOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!activePage || collectMutation.isPending}
              onClick={() => {
                if (!activePage) return;
                setCensysOpen(false);
                collectMutation.mutate({ id: activePage.id, providers: ["censys"] });
              }}
            >
              <Search className="size-4" /> Load host &amp; services
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{activePage?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the page, its notes, and every captured evidence run. This cannot be undone.
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
    </>
  );
}

function NewResearchForm({
  busy,
  initialSubject,
  initialParentId,
  pages,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  initialSubject: string;
  initialParentId: string | null;
  pages: ResearchPage[];
  onCancel: () => void;
  onCreate: (input: { subject: string; title?: string; parentId: string | null }) => void;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [title, setTitle] = useState("");
  const [parentId, setParentId] = useState(initialParentId ?? "__none__");
  return (
    <>
      <div className="space-y-4 py-1">
        <div className="space-y-2">
          <Label htmlFor="m-research-subject">Domain or IP address</Label>
          <Input
            id="m-research-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="suspicious.example or 203.0.113.42"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="m-research-parent">Parent page</Label>
          <Select value={parentId} onValueChange={setParentId}>
            <SelectTrigger id="m-research-parent" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No parent (top level)</SelectItem>
              {pages.map((page) => <SelectItem key={page.id} value={page.id}>{page.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="m-research-title">
            Page title <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="m-research-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Possible credential-phishing infrastructure"
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={busy || !subject.trim()}
          onClick={() => onCreate({ subject, ...(title.trim() ? { title } : {}), parentId: parentId === "__none__" ? null : parentId })}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Create &amp; research
        </Button>
      </DialogFooter>
    </>
  );
}

/** One captured evidence item, compact: provider chip, summary, expandable raw JSON. */
function MobileEvidenceCard({ evidence }: { evidence: ResearchEvidence }) {
  const meta = PROVIDER_META[evidence.provider] ?? {
    label: evidence.provider,
    icon: Database,
    className: "bg-muted text-muted-foreground",
  };
  const Icon = meta.icon;
  return (
    <article
      id={`evidence-${evidence.id}`}
      className={cn(
        "rounded-xl border bg-card p-2.5",
        evidence.status !== "success" && "border-amber-500/35 bg-amber-500/[0.04]",
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", meta.className)}>
          <Icon className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="min-w-0">
              <p className="truncate text-[13px] leading-5 font-medium">{evidence.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {meta.label} · {evidence.kind}
              </p>
            </div>
            {evidence.status !== "success" && (
              <Badge variant="outline" className="border-amber-500/40 text-[0.6rem] text-amber-700 dark:text-amber-300">
                <CircleAlert className="size-3" /> {evidence.status}
              </Badge>
            )}
          </div>
          {evidence.summary && <p className="mt-1.5 text-xs text-muted-foreground">{evidence.summary}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px]">
            <details>
              <summary className="cursor-pointer select-none text-primary active:underline">
                View captured evidence
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-muted/70 p-2.5 text-[10px] leading-4 break-all whitespace-pre-wrap">
                {JSON.stringify(evidence.data, null, 2)}
              </pre>
            </details>
            {evidence.sourceUrl && (
              <a
                href={evidence.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary active:underline"
              >
                Open provider <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
