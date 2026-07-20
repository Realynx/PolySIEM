import { requirePageUser } from "@/lib/auth/guards";
import { listLogSources } from "@/lib/services/logs";
import { listOtxSources } from "@/lib/services/threat-intel";
import { ThreatsHub, type ThreatsTab } from "@/components/logs/threats-hub";

export const dynamic = "force-dynamic";

export const metadata = { title: "Threats" };

/** Combined threats page: AI threat watch + OTX threat intel as tabs. */
export default async function ThreatsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { user } = await requirePageUser();
  const [{ tab }, logSources, otxSources] = await Promise.all([
    searchParams,
    listLogSources(),
    listOtxSources(user.id),
  ]);

  const initialTab: ThreatsTab = tab === "intel" ? "intel" : "watch";
  return (
    <ThreatsHub
      initialTab={initialTab}
      logSources={logSources}
      otxSources={otxSources}
      isAdmin={user.role === "ADMIN"}
    />
  );
}
