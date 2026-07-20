"use client";

import Link from "next/link";
import { Rss, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ThreatsTab } from "@/components/logs/threats-hub";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty } from "@/components/mobile/ui/mobile-list";
import { MobileSegmented } from "@/components/mobile/ui/mobile-segmented";
import { MobileThreatIntel } from "./mobile-threat-intel";
import { MobileThreatWatch } from "./mobile-threat-watch";

interface Source {
  id: string;
  name: string;
}

/**
 * Phone threats hub: Watch (AI ticket queue) and Intel (OTX feed) as segmented
 * views of one page. Tabs are URL-driven (?tab=intel) so deep links keep
 * working; `active` is passed explicitly because both hrefs share a pathname.
 */
export function MobileThreatsHub({
  tab,
  logSources,
  otxSources,
  isAdmin,
}: {
  tab: ThreatsTab;
  logSources: Source[];
  otxSources: Source[];
  isAdmin: boolean;
}) {
  return (
    <>
      <MobilePageHeader title="Threats">
        <MobileSegmented
          items={[
            { label: "Watch", href: "/logs/threats", active: tab === "watch" },
            { label: "Intel", href: "/logs/threats?tab=intel", active: tab === "intel" },
          ]}
        />
      </MobilePageHeader>
      <MobilePage>
        {tab === "watch" &&
          (logSources.length === 0 ? (
            <MobileEmpty
              icon={<ShieldAlert />}
              title="No log source configured"
              description="Threat watch scans logs live from Elasticsearch. Connect an Elasticsearch (or compatible) instance as an integration first."
              action={
                isAdmin ? (
                  <Button asChild size="sm">
                    <Link href="/settings/integrations">Add an integration</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <MobileThreatWatch isAdmin={isAdmin} />
          ))}

        {tab === "intel" &&
          (otxSources.length === 0 ? (
            <MobileEmpty
              icon={<Rss />}
              title="No threat-intelligence feed configured"
              description="Connect a free AlienVault OTX account and the latest community threat reports show up here. Add a personal OTX key in your profile settings."
              action={
                <Button asChild size="sm" variant={isAdmin ? "outline" : "default"}>
                  <Link href="/settings/profile">Add my OTX key</Link>
                </Button>
              }
            />
          ) : (
            <MobileThreatIntel sources={otxSources} isAdmin={isAdmin} />
          ))}
      </MobilePage>
    </>
  );
}
