import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { formatRelative } from "@/lib/format";
import { conciseChildTitle } from "@/lib/docs/titles";
import { AiInterviewLauncher } from "@/components/docs/ai-interview-panel";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";

export interface MobileDocRow {
  id: string;
  slug: string;
  title: string;
  parentId: string | null;
  updatedAt: Date;
  createdVia: string;
  author: { username: string; displayName: string | null } | null;
}

interface FlatNode {
  doc: MobileDocRow;
  depth: number;
  parentTitle: string;
}

/** Depth-first flatten of the parentId tree so rows can indent by depth. */
function flattenTree(docs: MobileDocRow[]): FlatNode[] {
  const children = new Map<string | null, MobileDocRow[]>();
  const ids = new Set(docs.map((d) => d.id));
  for (const doc of docs) {
    // Orphaned parents render at the root rather than disappearing.
    const key = doc.parentId && ids.has(doc.parentId) ? doc.parentId : null;
    const bucket = children.get(key);
    if (bucket) bucket.push(doc);
    else children.set(key, [doc]);
  }
  const out: FlatNode[] = [];
  const walk = (parentId: string | null, depth: number, parentTitle: string) => {
    for (const doc of children.get(parentId) ?? []) {
      out.push({ doc, depth, parentTitle });
      walk(doc.id, depth + 1, doc.title);
    }
  };
  walk(null, 0, "");
  return out;
}

// MobileListRow pads px-3.5; deeper levels override the left padding.
const INDENT = ["", "pl-8", "pl-12", "pl-16"];

/** Phone docs list: recently updated on top, then the full page tree with indent. */
export function MobileDocsPage({ docs }: { docs: MobileDocRow[] }) {
  const flat = flattenTree(docs);
  const titlesById = new Map(docs.map((doc) => [doc.id, doc.title]));
  const recent = [...docs]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 5);

  return (
    <>
      <MobilePageHeader title="Docs" actions={<AiInterviewLauncher />} />
      <MobilePage className="pb-20">
        {docs.length === 0 ? (
          <MobileEmpty
            icon={<FileText />}
            title="No documentation yet"
            description="Write your first page — markdown supported, organized in a tree."
          />
        ) : (
          <>
            <MobileSection title="Recently updated">
              <MobileList>
                {recent.map((doc) => (
                  <MobileListRow
                    key={doc.id}
                    href={`/docs/${doc.slug}`}
                    title={conciseChildTitle(
                      doc.title,
                      doc.parentId ? (titlesById.get(doc.parentId) ?? "") : "",
                    )}
                    subtitle={
                      <>
                        Updated {formatRelative(doc.updatedAt)}
                        {doc.author && <> · {doc.author.displayName || doc.author.username}</>}
                        {doc.createdVia === "mcp" && <> · via MCP</>}
                      </>
                    }
                  />
                ))}
              </MobileList>
            </MobileSection>
            <MobileSection title="All pages">
              <MobileList>
                {flat.map(({ doc, depth, parentTitle }) => (
                  <MobileListRow
                    key={doc.id}
                    href={`/docs/${doc.slug}`}
                    className={INDENT[Math.min(depth, INDENT.length - 1)]}
                    leading={<FileText className="size-4" />}
                    title={conciseChildTitle(doc.title, parentTitle)}
                  />
                ))}
              </MobileList>
            </MobileSection>
          </>
        )}
      </MobilePage>
      {/* MobileFab styling as a Link: the primitive is a <button>, this action navigates. */}
      <Link
        href="/docs/new"
        aria-label="New page"
        className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex size-13 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg transition-transform outline-none active:scale-95 focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-6"
      >
        <Plus />
      </Link>
    </>
  );
}
