import { Fragment } from "react";
import Link from "next/link";
import { FileText, Pencil } from "lucide-react";
import { formatRelative } from "@/lib/format";
import { conciseChildTitle } from "@/lib/docs/titles";
import { Markdown } from "@/components/docs/markdown";
import { DeleteEntityButton } from "@/components/inventory/delete-entity-button";
import { TagPicker } from "@/components/inventory/tag-picker";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";

export interface MobileDocViewerProps {
  doc: {
    id: string;
    slug: string;
    title: string;
    content: string;
    updatedAt: Date;
    createdVia: string;
    author: { username: string; displayName: string | null } | null;
    parent: { title: string } | null;
    tags: { tag: { id: string; name: string; color: string } }[];
    children: { id: string; slug: string; title: string }[];
  };
  crumbs: { title: string; slug: string }[];
}

/**
 * Phone doc page: same Markdown renderer (node embeds keep working) with a
 * typographic pass for a 412px column — smaller headings, scrollable code.
 */
export function MobileDocViewer({ doc, crumbs }: MobileDocViewerProps) {
  return (
    <>
      <MobilePageHeader
        backHref="/docs"
        title={conciseChildTitle(doc.title, doc.parent?.title ?? "")}
        actions={
          <>
            <Link
              href={`/docs/${doc.slug}/edit`}
              aria-label="Edit page"
              className="flex size-10 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
            >
              <Pencil className="size-4.5" />
            </Link>
            <DeleteEntityButton
              apiPath={`/api/docs/${doc.id}`}
              entityLabel={`page “${doc.title}”`}
              redirectTo="/docs"
              iconOnly
            />
          </>
        }
      />
      <MobilePage>
        <div className="flex flex-col gap-0.5 px-0.5">
          {crumbs.length > 0 && (
            <p className="no-scrollbar overflow-x-auto font-mono text-[11px] whitespace-nowrap text-muted-foreground">
              {crumbs.map((crumb) => (
                <Fragment key={crumb.slug}>
                  <Link href={`/docs/${crumb.slug}`} className="underline-offset-2 active:underline">
                    {crumb.title}
                  </Link>
                  <span className="mx-1 opacity-60">/</span>
                </Fragment>
              ))}
              <span>{doc.title}</span>
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Updated {formatRelative(doc.updatedAt)}
            {doc.author && <> by {doc.author.displayName || doc.author.username}</>}
            {doc.createdVia === "mcp" && <> · via MCP</>}
          </p>
        </div>

        <Markdown
          content={doc.content}
          className="leading-6.5 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:text-xs [&_table]:block [&_table]:overflow-x-auto"
        />

        <MobileSection title="Tags">
          <div className="rounded-xl border bg-card px-3.5 py-3">
            <TagPicker
              entityType="doc"
              entityId={doc.id}
              assigned={doc.tags.map((t) => ({
                id: t.tag.id,
                name: t.tag.name,
                color: t.tag.color,
              }))}
            />
          </div>
        </MobileSection>

        {doc.children.length > 0 && (
          <MobileSection title={`Child pages · ${doc.children.length}`}>
            <MobileList>
              {doc.children.map((child) => (
                <MobileListRow
                  key={child.id}
                  href={`/docs/${child.slug}`}
                  leading={<FileText className="size-4" />}
                  title={conciseChildTitle(child.title, doc.title)}
                />
              ))}
            </MobileList>
          </MobileSection>
        )}
      </MobilePage>
    </>
  );
}
