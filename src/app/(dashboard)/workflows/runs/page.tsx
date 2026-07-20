import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { PageHeader } from "@/components/shared/page-header";
import { GlobalRunsTable } from "@/components/workflows/runs-table";
import { MobileWorkflowRunsPage } from "@/components/mobile/pages/workflows/mobile-workflow-runs";

export const dynamic = "force-dynamic";

export const metadata = { title: "Run history" };

export default async function WorkflowRunsPage() {
  await requirePageUser();

  if (await isMobileView()) return <MobileWorkflowRunsPage />;

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
