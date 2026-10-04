import { requirePageAdmin } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { detectTuningState } from "@/lib/postgres-tuning/detect";
import type { TuningState } from "@/lib/postgres-tuning/model";
import { PageHeader } from "@/components/shared/page-header";
import { PostgresTuningPanel } from "@/components/settings/database/postgres-tuning-panel";
import { MobileSettingsSubpage } from "@/components/mobile/pages/settings/settings-subpage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const metadata = { title: "Database" };
export const dynamic = "force-dynamic";

const DESCRIPTION = "Tune PostgreSQL to the memory, CPUs and disk this installation actually has.";

async function loadState(): Promise<{ state: TuningState } | { error: string }> {
  try {
    return { state: await detectTuningState() };
  } catch (error) {
    console.error("postgres tuning detection failed:", error);
    return { error: "PolySIEM could not read PostgreSQL's settings. Check that the database is reachable and reload." };
  }
}

export default async function DatabaseSettingsPage() {
  await requirePageAdmin();
  const result = await loadState();

  const content =
    "state" in result ? (
      <PostgresTuningPanel initial={result.state} />
    ) : (
      <Alert variant="destructive">
        <AlertTitle>Database unavailable</AlertTitle>
        <AlertDescription>{result.error}</AlertDescription>
      </Alert>
    );

  if (await isMobileView()) {
    return <MobileSettingsSubpage title="Database">{content}</MobileSettingsSubpage>;
  }

  return (
    <div>
      <PageHeader title="Database" description={DESCRIPTION} />
      {content}
    </div>
  );
}
