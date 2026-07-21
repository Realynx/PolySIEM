import Link from "next/link";
import { ChartColumn } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { listLogSources } from "@/lib/services/logs";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { InsightsPanel } from "@/components/logs/insights/insights-panel";
import { MobileInsights } from "@/components/mobile/pages/insights/mobile-insights";

export const dynamic = "force-dynamic";

export const metadata = { title: "Network insights" };

/** Windows the insights API accepts; the phone view drives this via ?hours=. */
const WINDOW_HOURS = [1, 6, 24, 168];

export default async function NetworkInsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ hours?: string }>;
}) {
  const { user } = await requirePageUser();
  const sources = await anonymizeForDisplay(await listLogSources());

  if (await isMobileView()) {
    const { hours: hoursParam } = await searchParams;
    const parsed = Number(hoursParam);
    const hours = WINDOW_HOURS.includes(parsed) ? parsed : 24;
    return <MobileInsights sources={sources} isAdmin={user.role === "ADMIN"} hours={hours} />;
  }

  if (sources.length === 0) {
    return (
      <EmptyState
        icon={ChartColumn}
        title="No Elasticsearch integration configured"
        description="Connect the Elasticsearch instance receiving your network and security logs to build a live, customizable insights dashboard."
        action={
          user.role === "ADMIN" ? (
            <Button asChild>
              <Link href="/settings/integrations">Add an integration</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return <InsightsPanel sources={sources} isAdmin={user.role === "ADMIN"} />;
}
