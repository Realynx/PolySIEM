export const RESEARCH_QUERY_KEY = ["security-research"] as const;

export type EvidenceStatus = "success" | "error" | "unavailable";

export interface ResearchEvidence {
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
}

export interface ResearchPage {
  id: string;
  title: string;
  subject: string;
  subjectType: "ip" | "domain";
  parentId: string | null;
  status: "open" | "archived";
  verdict: "unknown" | "benign" | "suspicious" | "malicious";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lastResearchedAt: string | null;
  createdBy: { id: string; username: string; displayName: string | null } | null;
  evidence: ResearchEvidence[];
}

export interface ResearchTreeNode {
  page: ResearchPage;
  children: ResearchTreeNode[];
}

export interface ResearchRun {
  runId: string;
  items: ResearchEvidence[];
  capturedAt: string;
}

export interface FlatResearchPage {
  page: ResearchPage;
  depth: number;
}

export function displayResearchDate(value: string | null): string {
  if (!value) return "Not researched yet";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function groupResearchEvidence(evidence: ResearchEvidence[]): ResearchRun[] {
  const groups = new Map<string, ResearchEvidence[]>();
  for (const item of evidence) groups.set(item.runId, [...(groups.get(item.runId) ?? []), item]);
  return [...groups.entries()].map(([runId, items]) => ({ runId, items, capturedAt: items[0]?.capturedAt ?? "" }));
}

export function buildResearchTree(pages: ResearchPage[]): ResearchTreeNode[] {
  const byId = new Map(pages.map((page) => [page.id, { page, children: [] as ResearchTreeNode[] }]));
  const roots: ResearchTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.page.parentId ? byId.get(node.page.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function filterResearchTree(nodes: ResearchTreeNode[], query: string): ResearchTreeNode[] {
  const term = query.trim().toLowerCase();
  if (!term) return nodes;
  return nodes.flatMap((node) => {
    const matches = `${node.page.title} ${node.page.subject}`.toLowerCase().includes(term);
    const children = filterResearchTree(node.children, query);
    return matches || children.length > 0 ? [{ ...node, children: matches ? node.children : children }] : [];
  });
}

export function researchAncestorChain(page: ResearchPage, pages: ResearchPage[]): ResearchPage[] {
  const byId = new Map(pages.map((candidate) => [candidate.id, candidate]));
  const chain: ResearchPage[] = [];
  const visited = new Set<string>([page.id]);
  let cursor = page.parentId;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const parent = byId.get(cursor);
    if (!parent) break;
    chain.unshift(parent);
    cursor = parent.parentId;
  }
  return chain;
}

export function researchDescendantIds(pageId: string, pages: ResearchPage[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const page of pages) {
    if (page.parentId) children.set(page.parentId, [...(children.get(page.parentId) ?? []), page.id]);
  }
  const found = new Set<string>();
  const visit = (id: string) => {
    for (const child of children.get(id) ?? []) {
      if (child === pageId || found.has(child)) continue;
      found.add(child);
      visit(child);
    }
  };
  visit(pageId);
  return found;
}

export function flattenResearchTree(pages: ResearchPage[]): FlatResearchPage[] {
  const children = new Map<string | null, ResearchPage[]>();
  const ids = new Set(pages.map((page) => page.id));
  for (const page of pages) {
    const parentId = page.parentId && ids.has(page.parentId) ? page.parentId : null;
    children.set(parentId, [...(children.get(parentId) ?? []), page]);
  }
  const result: FlatResearchPage[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    for (const page of children.get(parentId) ?? []) {
      if (visited.has(page.id)) continue;
      visited.add(page.id);
      result.push({ page, depth });
      visit(page.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}
