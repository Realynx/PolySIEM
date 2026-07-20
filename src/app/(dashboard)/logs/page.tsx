import Link from "next/link";
import { ScrollText } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { listLogSources } from "@/lib/services/logs";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { LogExplorer } from "@/components/logs/log-explorer";

export const dynamic = "force-dynamic";

export const metadata = { title: "Log explorer" };

export default async function LogsPage() {
  const { user } = await requirePageUser();
  const sources = await listLogSources();

  if (sources.length === 0) {
    return (
      <>
        <PageHeader
          title="Log explorer"
          description="Search and inspect logs from your homelab, queried live from Elasticsearch."
        />
        <EmptyState
          icon={ScrollText}
          title="No log source configured"
          description="Connect an Elasticsearch (or compatible) instance as an integration and PolySIEM will query it live — logs are never copied into the database."
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

  return <LogExplorer sources={sources} />;
}
