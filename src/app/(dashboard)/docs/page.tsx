import Link from "next/link";
import { ChevronRight, FileText, Plus } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { listDocs } from "@/lib/services/docs";
import { formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TagList } from "@/components/inventory/tag-badge";
import { AiInterviewLauncher } from "@/components/docs/ai-interview-panel";
import { conciseChildTitle } from "@/lib/docs/titles";

export const metadata = { title: "Documentation" };

type DocRow = Awaited<ReturnType<typeof listDocs>>[number];

interface TreeNode {
  doc: DocRow;
  children: TreeNode[];
}

function buildTree(docs: DocRow[]): TreeNode[] {
  const byId = new Map(docs.map((d) => [d.id, { doc: d, children: [] as TreeNode[] }]));
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.doc.parentId ? byId.get(node.doc.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function DocTree({
  nodes,
  depth = 0,
  parentTitle = "",
}: {
  nodes: TreeNode[];
  depth?: number;
  parentTitle?: string;
}) {
  return (
    <ul className={depth > 0 ? "ml-4 border-l pl-2" : undefined}>
      {nodes.map((node) => (
        <li key={node.doc.id}>
          <Link
            href={`/docs/${node.doc.slug}`}
            className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate group-hover:text-primary">
              {conciseChildTitle(node.doc.title, parentTitle)}
            </span>
          </Link>
          {node.children.length > 0 && (
            <DocTree
              nodes={node.children}
              depth={depth + 1}
              parentTitle={node.doc.title}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function DocsPage() {
  await requirePageUser();
  const docs = await listDocs();
  const tree = buildTree(docs);
  const titlesById = new Map(docs.map((doc) => [doc.id, doc.title]));
  const recent = [...docs]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 10);

  const newButton = (
    <Button asChild>
      <Link href="/docs/new">
        <Plus />
        New page
      </Link>
    </Button>
  );

  const headerActions = (
    <>
      <AiInterviewLauncher />
      {newButton}
    </>
  );

  return (
    <div>
      <PageHeader
        title="Documentation"
        description="Your homelab wiki — runbooks, notes and how-tos"
        actions={headerActions}
      />
      {docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documentation yet"
          description="Write your first page — markdown supported, organized in a tree."
          action={newButton}
        />
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">All pages</CardTitle>
            </CardHeader>
            <CardContent className="px-3">
              <DocTree nodes={tree} />
            </CardContent>
          </Card>
          <Card className="gap-3 overflow-hidden pb-0">
            <CardHeader>
              <CardTitle className="text-sm">Recently updated</CardTitle>
            </CardHeader>
            <div className="divide-y border-t">
              {recent.map((doc) => (
                <Link
                  key={doc.id}
                  href={`/docs/${doc.slug}`}
                  className="group flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium group-hover:text-primary">
                      {conciseChildTitle(
                        doc.title,
                        doc.parentId ? titlesById.get(doc.parentId) ?? "" : "",
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      Updated {formatRelative(doc.updatedAt)}
                      {doc.author && <> · {doc.author.displayName || doc.author.username}</>}
                      {doc.createdVia === "mcp" && <> · via MCP</>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="hidden sm:block">
                      <TagList tags={doc.tags} />
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
