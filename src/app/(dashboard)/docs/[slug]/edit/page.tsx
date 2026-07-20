import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth/guards";
import { getDoc, listDocs } from "@/lib/services/docs";
import { isMobileView } from "@/lib/device";
import { MobileDocEditorPage } from "@/components/mobile/pages/docs/mobile-doc-editor-page";
import { PageHeader } from "@/components/shared/page-header";
import { DocEditor } from "@/components/docs/doc-editor";

export const metadata = { title: "Edit page" };

export default async function EditDocPage({ params }: { params: Promise<{ slug: string }> }) {
  await requirePageUser();
  const { slug } = await params;
  const doc = await getDoc(slug).catch(() => null);
  if (!doc) notFound();

  const docs = await listDocs();
  const pages = docs.map((d) => ({ id: d.id, title: d.title, slug: d.slug }));
  const editorDoc = {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    content: doc.content,
    parentId: doc.parentId,
  };

  if (await isMobileView()) {
    return (
      <MobileDocEditorPage
        title={`Edit “${doc.title}”`}
        backHref={`/docs/${doc.slug}`}
        mode="edit"
        pages={pages}
        doc={editorDoc}
      />
    );
  }

  return (
    <div>
      <PageHeader title={`Edit “${doc.title}”`} description="Changes are saved when you hit Save page" />
      <DocEditor mode="edit" pages={pages} doc={editorDoc} />
    </div>
  );
}
