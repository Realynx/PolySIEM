import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getOllamaConfig, getSetupState, sanitizeAiConfig } from "@/lib/settings";
import { SetupWizard } from "./setup-wizard";

export const metadata = { title: "Setup" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const [state, session, aiConfig] = await Promise.all([
    getSetupState(),
    getSession(),
    getOllamaConfig(),
  ]);
  if (state.completed) redirect(session ? "/" : "/login");
  if (state.started && !session) redirect("/login?next=/setup");
  return (
    <SetupWizard
      initialStage={state.stage}
      initialAiConfig={sanitizeAiConfig(aiConfig)}
    />
  );
}
