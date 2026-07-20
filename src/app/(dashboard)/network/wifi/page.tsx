import Link from "next/link";
import { Wifi } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { SsidTable } from "@/components/wifi/ssid-table";
import { ApTable } from "@/components/wifi/ap-table";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobileWifi } from "@/components/mobile/pages/network-edge/mobile-wifi";

export const dynamic = "force-dynamic";

export const metadata = { title: "WiFi" };

export default async function WifiPage() {
  const { user } = await requirePageUser();
  const [ssids, aps] = await anonymizeForDisplay(await Promise.all([
    prisma.wirelessNetwork.findMany({
      where: { status: { not: "REMOVED" } },
      include: { network: { select: { id: true, name: true, cidr: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.wirelessAp.findMany({
      where: { status: { not: "REMOVED" } },
      include: { device: { select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
  ]));

  const mobile = await isMobileView();

  if (ssids.length === 0 && aps.length === 0) {
    const empty = (
      <EmptyState
        icon={Wifi}
        title="No WiFi documented yet"
        description="Connect a UniFi integration and run a sync to document your SSIDs and access points here."
        action={
          user.role === "ADMIN" ? (
            <Button asChild>
              <Link href="/settings/integrations">Add an integration</Link>
            </Button>
          ) : undefined
        }
      />
    );
    if (mobile) {
      return (
        <>
          <MobilePageHeader title="WiFi" />
          <MobilePage>{empty}</MobilePage>
        </>
      );
    }
    return (
      <>
        <PageHeader
          title="WiFi"
          description="Wireless networks and access points documented from your UniFi controller."
        />
        {empty}
      </>
    );
  }

  if (mobile) return <MobileWifi ssids={ssids} aps={aps} />;

  return (
    <>
      <PageHeader
        title="WiFi"
        description="Wireless networks and access points documented from your UniFi controller."
      />
      <div className="space-y-8">
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Wireless networks
          </h2>
          {ssids.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No wireless networks documented yet.
            </p>
          ) : (
            <SsidTable ssids={ssids} />
          )}
        </section>
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Access points
          </h2>
          {aps.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No access points documented yet.
            </p>
          ) : (
            <ApTable aps={aps} />
          )}
        </section>
      </div>
    </>
  );
}
