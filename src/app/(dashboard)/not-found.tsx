import Link from "next/link";
import { SearchX } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export default function DashboardNotFound() {
  return (
    <>
      <PageHeader title="Not found" />
      <EmptyState
        icon={SearchX}
        title="This item doesn't exist"
        description="It may have been deleted, or removed by an integration sync."
        action={
          <Button asChild>
            <Link href="/">Back to dashboard</Link>
          </Button>
        }
      />
    </>
  );
}
