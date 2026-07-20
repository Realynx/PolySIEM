import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { listLogSources } from "@/lib/services/logs";
import { listOtxSources } from "@/lib/services/threat-intel";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { ThreatsHub, type ThreatsTab } from "@/components/logs/threats-hub";
import { MobileThreatsHub } from "@/components/mobile/pages/security/mobile-threats-hub";

export const dynamic = "force-dynamic";

export const metadata = { title: "Threats" };

/** Combined threats page: AI threat watch + OTX threat intel as tabs. */
export default async function ThreatsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { user } = await requirePageUser();
  const [{ tab }, rawLogSources, rawOtxSources] = await Promise.all([
    searchParams,
    listLogSources(),
    listOtxSources(user.id),
  ]);
  const logSources = await anonymizeForDisplay(rawLogSources);
  const otxSources = await anonymizeForDisplay(rawOtxSources);

  const initialTab: ThreatsTab = tab === "intel" ? "intel" : "watch";
  if (await isMobileView()) {
    return (
      <MobileThreatsHub
        tab={initialTab}
        logSources={logSources}
        otxSources={otxSources}
        isAdmin={user.role === "ADMIN"}
      />
    );
  }
  return (
    <ThreatsHub
      initialTab={initialTab}
      logSources={logSources}
      otxSources={otxSources}
      isAdmin={user.role === "ADMIN"}
    />
  );
}
