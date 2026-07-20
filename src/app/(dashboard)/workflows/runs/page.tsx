import { requirePageUser } from "@/lib/auth/guards";
import { PageHeader } from "@/components/shared/page-header";
import { GlobalRunsTable } from "@/components/workflows/runs-table";

export const dynamic = "force-dynamic";

export const metadata = { title: "Run history" };

export default async function WorkflowRunsPage() {
  await requirePageUser();

  return (
    <div>
      <PageHeader
        title="Run history"
        description="Every workflow execution across your lab — click a run for its step-by-step results"
      />
      <GlobalRunsTable />
    </div>
  );
}
