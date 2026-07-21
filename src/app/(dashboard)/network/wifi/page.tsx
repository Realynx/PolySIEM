import Link from "next/link";
import { CircleCheck, Radio, Router, ShieldCheck, TriangleAlert, Users, Wifi } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { OperationsOverview } from "@/components/shared/operations-overview";
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

  const enabledSsids = ssids.filter((ssid) => ssid.enabled).length;
  const securedSsids = ssids.filter((ssid) => ssid.security && ssid.security !== "open").length;
  const guestSsids = ssids.filter((ssid) => ssid.isGuest).length;
  const onlineAps = aps.filter((ap) => ap.state === "online").length;
  const offlineAps = aps.filter((ap) => ap.state === "offline").length;

  return (
    <>
      <PageHeader
        title="WiFi"
        description="Wireless networks and access points documented from your UniFi controller."
      />
      <div className="space-y-4">
        <OperationsOverview
          icon={<Wifi className="size-5" aria-hidden />}
          title="Wireless estate"
          description="Broadcast, security, and access-point health from the connected UniFi controller."
          status={
            offlineAps > 0 ? (
              <>
                <TriangleAlert className="size-3.5" aria-hidden />
                {offlineAps} offline {offlineAps === 1 ? "AP" : "APs"}
              </>
            ) : (
              <>
                <CircleCheck className="size-3.5" aria-hidden />
                Wireless is healthy
              </>
            )
          }
          statusTone={offlineAps > 0 ? "warning" : "success"}
          metrics={[
            {
              icon: <Radio />,
              label: "Wireless networks",
              value: ssids.length.toLocaleString(),
              detail: `${enabledSsids.toLocaleString()} broadcasting`,
            },
            {
              icon: <Router />,
              label: "Access points",
              value: aps.length.toLocaleString(),
              detail: `${onlineAps.toLocaleString()} online`,
              tone: offlineAps > 0 ? "warning" : "success",
            },
            {
              icon: <ShieldCheck />,
              label: "Secured SSIDs",
              value: securedSsids.toLocaleString(),
              detail: `${(ssids.length - securedSsids).toLocaleString()} open or unknown`,
              tone: securedSsids === ssids.length ? "success" : "warning",
            },
            {
              icon: <Users />,
              label: "Guest networks",
              value: guestSsids.toLocaleString(),
              detail: "Isolated visitor access",
            },
          ]}
        />
        <SsidTable ssids={ssids} />
        <ApTable aps={aps} />
      </div>
    </>
  );
}
