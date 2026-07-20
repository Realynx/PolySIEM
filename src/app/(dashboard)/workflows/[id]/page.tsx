import { requirePageUser } from "@/lib/auth/guards";
import { WorkflowBuilder } from "@/components/workflows/builder";

export const dynamic = "force-dynamic";

export const metadata = { title: "Workflow builder" };

export default async function WorkflowBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requirePageUser();
  const { id } = await params;

  return <WorkflowBuilder workflowId={id} isAdmin={user.role === "ADMIN"} />;
}
