import { requirePageUser } from "@/lib/auth/guards";
import { listDocs } from "@/lib/services/docs";
import { isMobileView } from "@/lib/device";
import { MobileDocEditorPage } from "@/components/mobile/pages/docs/mobile-doc-editor-page";
import { PageHeader } from "@/components/shared/page-header";
import { DocEditor } from "@/components/docs/doc-editor";
import type { PageSearchParams } from "@/components/inventory/query";

export const metadata = { title: "New page" };

export default async function NewDocPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  await requirePageUser();
  const sp = await searchParams;
  const parentParam = Array.isArray(sp.parent) ? sp.parent[0] : sp.parent;
  const docs = await listDocs();
  const pages = docs.map((d) => ({ id: d.id, title: d.title, slug: d.slug }));
  const defaultParentId = parentParam && pages.some((p) => p.id === parentParam) ? parentParam : null;

  if (await isMobileView()) {
    return (
      <MobileDocEditorPage
        title="New page"
        backHref="/docs"
        mode="create"
        pages={pages}
        defaultParentId={defaultParentId}
      />
    );
  }

  return (
    <div>
      <PageHeader title="New page" description="Write a new documentation page in markdown" />
      <DocEditor mode="create" pages={pages} defaultParentId={defaultParentId} />
    </div>
  );
}
