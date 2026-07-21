import { Tags } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { listTags } from "@/lib/services/tags";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { isMobileView } from "@/lib/device";
import { MobileTagsPage } from "@/components/mobile/pages/docs/mobile-tags-page";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateTagDialog } from "@/components/inventory/create-tag-dialog";
import { DeleteEntityButton } from "@/components/inventory/delete-entity-button";
import { ListCard } from "@/components/inventory/list-card";
import { TagBadge } from "@/components/inventory/tag-badge";

export const metadata = { title: "Tags" };

export default async function TagsPage() {
  await requirePageUser();
  const tags = await anonymizeForDisplay(await listTags());

  if (await isMobileView()) return <MobileTagsPage tags={tags} />;

  return (
    <div>
      <PageHeader
        title="Tags"
        description="Color-coded labels shared across inventory, network and docs"
        actions={<CreateTagDialog />}
      />
      {tags.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No tags yet"
          description="Create tags like “production” or “critical” and attach them to anything in PolySIEM."
          action={<CreateTagDialog />}
        />
      ) : (
        <ListCard
          title="Tag library"
          description="Shared labels available across inventory, networking, and documentation."
          resultCount={tags.length}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead className="hidden sm:table-cell">Color</TableHead>
                <TableHead className="text-right">Assignments</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tags.map((tag) => (
                <TableRow key={tag.id}>
                  <TableCell>
                    <TagBadge name={tag.name} color={tag.color} />
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground capitalize sm:table-cell">
                    {tag.color}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {tag._count.assignments}
                  </TableCell>
                  <TableCell>
                    <DeleteEntityButton
                      apiPath={`/api/tags/${tag.id}`}
                      entityLabel={`tag “${tag.name}”`}
                      iconOnly
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ListCard>
      )}
    </div>
  );
}
