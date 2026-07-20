import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { WorkflowBuilder } from "@/components/workflows/builder";
import { MobileWorkflowDetailPage } from "@/components/mobile/pages/workflows/mobile-workflow-detail";

export const dynamic = "force-dynamic";

export const metadata = { title: "Workflow builder" };

export default async function WorkflowBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requirePageUser();
  const { id } = await params;
  const isAdmin = user.role === "ADMIN";

  // A graph canvas is no place for thumbs — phones get a read/run companion
  // view over the same workflow data; editing stays in the desktop builder.
  if (await isMobileView()) {
    return <MobileWorkflowDetailPage workflowId={id} isAdmin={isAdmin} />;
  }

  return <WorkflowBuilder workflowId={id} isAdmin={isAdmin} />;
}
