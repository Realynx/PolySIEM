import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Pencil } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { getDoc, listDocs } from "@/lib/services/docs";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { isMobileView } from "@/lib/device";
import { MobileDocViewer } from "@/components/mobile/pages/docs/mobile-doc-viewer";
import { formatDateTime, formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DeleteEntityButton } from "@/components/inventory/delete-entity-button";
import { SectionCard } from "@/components/inventory/detail-bits";
import { TagPicker } from "@/components/inventory/tag-picker";
import { Markdown } from "@/components/docs/markdown";
import { conciseChildTitle } from "@/lib/docs/titles";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = await anonymizeForDisplay(await getDoc(slug).catch(() => null));
  return {
    title: doc
      ? conciseChildTitle(doc.title, doc.parent?.title ?? "")
      : "Documentation",
  };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  await requirePageUser();
  const { slug } = await params;
  const rawDoc = await getDoc(slug).catch(() => null);
  if (!rawDoc) notFound();
  const doc = await anonymizeForDisplay(rawDoc);

  // Breadcrumb chain: walk parentId links using the (single-query) full list.
  const all = await listDocs();
  const byId = new Map(all.map((d) => [d.id, d]));
  const chain: { title: string; slug: string }[] = [];
  let cursor = doc.parentId;
  while (cursor) {
    const parent = byId.get(cursor);
    if (!parent) break;
    const grandparent = parent.parentId ? byId.get(parent.parentId) : null;
    chain.unshift({
      title: conciseChildTitle(parent.title, grandparent?.title ?? ""),
      slug: parent.slug,
    });
    cursor = parent.parentId;
  }
  const crumbs = await anonymizeForDisplay(chain);

  if (await isMobileView()) return <MobileDocViewer doc={doc} crumbs={crumbs} />;

  return (
    <div>
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/docs">Documentation</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          {crumbs.map((crumb) => (
            <Fragment key={crumb.slug}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link href={`/docs/${crumb.slug}`}>{crumb.title}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
            </Fragment>
          ))}
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{doc.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        title={conciseChildTitle(doc.title, doc.parent?.title ?? "")}
        description={`Updated ${formatRelative(doc.updatedAt)}${
          doc.author ? ` by ${doc.author.displayName || doc.author.username}` : ""
        } · created ${formatDateTime(doc.createdAt)}${doc.createdVia === "mcp" ? " · via MCP" : ""}`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/docs/${doc.slug}/edit`}>
                <Pencil />
                Edit
              </Link>
            </Button>
            <DeleteEntityButton
              apiPath={`/api/docs/${doc.id}`}
              entityLabel={`page “${doc.title}”`}
              redirectTo="/docs"
            />
          </>
        }
      />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardContent>
            <Markdown content={doc.content} />
          </CardContent>
        </Card>
        <div className="space-y-6">
          <SectionCard title="Tags">
            <TagPicker
              entityType="doc"
              entityId={doc.id}
              assigned={doc.tags.map((t) => ({
                id: t.tag.id,
                name: t.tag.name,
                color: t.tag.color,
              }))}
            />
          </SectionCard>
          <SectionCard title="Child pages" count={doc.children.length}>
            {doc.children.length === 0 ? (
              <p className="text-sm text-muted-foreground">No child pages.</p>
            ) : (
              <ul className="space-y-1">
                {doc.children.map((child) => (
                  <li key={child.id}>
                    <Link
                      href={`/docs/${child.slug}`}
                      className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate group-hover:text-primary">
                        {conciseChildTitle(child.title, doc.title)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
