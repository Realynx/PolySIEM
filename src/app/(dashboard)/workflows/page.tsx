import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { PageHeader } from "@/components/shared/page-header";
import { CreateWorkflowDialog } from "@/components/workflows/create-workflow-dialog";
import { WorkflowList } from "@/components/workflows/workflow-list";
import { MobileWorkflowsPage } from "@/components/mobile/pages/workflows/mobile-workflows";

export const dynamic = "force-dynamic";

export const metadata = { title: "Workflows" };

export default async function WorkflowsPage() {
  const { user } = await requirePageUser();
  const isAdmin = user.role === "ADMIN";

  if (await isMobileView()) return <MobileWorkflowsPage isAdmin={isAdmin} />;

  return (
    <div>
      <PageHeader
        title="Workflows"
        description="Visual automations for your lab — drag nodes onto a canvas, wire them into a flow, and run them with one click"
        actions={isAdmin ? <CreateWorkflowDialog /> : undefined}
      />
      <WorkflowList isAdmin={isAdmin} />
    </div>
  );
}
