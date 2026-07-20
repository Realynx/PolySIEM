import Link from "next/link";
import { ChartColumn } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { listLogSources } from "@/lib/services/logs";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { InsightsPanel } from "@/components/logs/insights/insights-panel";

export const dynamic = "force-dynamic";

export const metadata = { title: "Network insights" };

export default async function NetworkInsightsPage() {
  const { user } = await requirePageUser();
  const sources = await listLogSources();

  if (sources.length === 0) {
    return (
      <>
        <PageHeader
          title="Network insights"
          description="A live overview of traffic, security signals, tunnels, and firewall activity from Elasticsearch."
        />
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
      </>
    );
  }

  return <InsightsPanel sources={sources} isAdmin={user.role === "ADMIN"} />;
}
