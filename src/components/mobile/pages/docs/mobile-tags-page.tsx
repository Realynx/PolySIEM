import { Tags } from "lucide-react";
import { CreateTagDialog } from "@/components/inventory/create-tag-dialog";
import { DeleteEntityButton } from "@/components/inventory/delete-entity-button";
import { TagBadge } from "@/components/inventory/tag-badge";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";

export interface MobileTagRow {
  id: string;
  name: string;
  color: string;
  _count: { assignments: number };
}

/** Phone tags screen: badge rows with usage counts and the existing CRUD dialogs. */
export function MobileTagsPage({ tags }: { tags: MobileTagRow[] }) {
  return (
    <>
      <MobilePageHeader title="Tags" actions={<CreateTagDialog />} />
      <MobilePage>
        {tags.length === 0 ? (
          <MobileEmpty
            icon={<Tags />}
            title="No tags yet"
            description="Create tags like “production” or “critical” and attach them to anything in PolySIEM."
          />
        ) : (
          <MobileSection title={`${tags.length} ${tags.length === 1 ? "tag" : "tags"}`}>
            <MobileList>
              {tags.map((tag) => (
                <MobileListRow
                  key={tag.id}
                  title={<TagBadge name={tag.name} color={tag.color} />}
                  subtitle={`${tag._count.assignments} ${
                    tag._count.assignments === 1 ? "assignment" : "assignments"
                  }`}
                  trailing={
                    <DeleteEntityButton
                      apiPath={`/api/tags/${tag.id}`}
                      entityLabel={`tag “${tag.name}”`}
                      iconOnly
                    />
                  }
                />
              ))}
            </MobileList>
          </MobileSection>
        )}
      </MobilePage>
    </>
  );
}
