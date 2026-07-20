"use client";

import { useState } from "react";
import Link from "next/link";
import { Rss, ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThreatPanel } from "@/components/logs/threats/threat-panel";
import { ThreatIntelPanel } from "@/components/logs/threat-intel/threat-intel-panel";

export type ThreatsTab = "watch" | "intel";

interface Source {
  id: string;
  name: string;
}

/**
 * Combined threats hub: "Watch" (AI ticket queue over local logs) and
 * "Intel" (OTX feed + IOC cross-match) as tabs of one page. Each tab keeps
 * its full existing panel — headers, actions and data flows unchanged; the
 * inactive tab unmounts and react-query caches make switching cheap.
 */
export function ThreatsHub({
  initialTab,
  logSources,
  otxSources,
  isAdmin,
}: {
  initialTab: ThreatsTab;
  logSources: Source[];
  otxSources: Source[];
  isAdmin: boolean;
}) {
  const [tab, setTab] = useState<ThreatsTab>(initialTab);

  function switchTab(next: string) {
    setTab(next as ThreatsTab);
    // Keep the URL deep-linkable without a server round-trip.
    window.history.replaceState(null, "", next === "intel" ? "/logs/threats?tab=intel" : "/logs/threats");
  }

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={switchTab}>
        <TabsList>
          <TabsTrigger value="watch" className="gap-1.5">
            <ShieldAlert className="size-3.5" />
            Threat watch
          </TabsTrigger>
          <TabsTrigger value="intel" className="gap-1.5">
            <Rss className="size-3.5" />
            Threat intel
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "watch" &&
        (logSources.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="No log source configured"
            description="Threat watch scans logs live from Elasticsearch. Connect an Elasticsearch (or compatible) instance as an integration first."
            action={
              isAdmin ? (
                <Button asChild>
                  <Link href="/settings/integrations">Add an integration</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ThreatPanel sources={logSources} isAdmin={isAdmin} />
        ))}

      {tab === "intel" &&
        (otxSources.length === 0 ? (
          <EmptyState
            icon={Rss}
            title="No threat-intelligence feed configured"
            description="Connect a free AlienVault OTX account and the latest community threat reports — and any of their indicators seen in your own logs — show up here. Anyone can add a personal OTX key in their profile settings; admins can also configure a shared instance feed."
            action={
              <div className="flex gap-2">
                <Button asChild variant={isAdmin ? "outline" : "default"}>
                  <Link href="/settings/profile">Add my OTX key</Link>
                </Button>
                {isAdmin && (
                  <Button asChild>
                    <Link href="/settings/integrations">Add an integration</Link>
                  </Button>
                )}
              </div>
            }
          />
        ) : (
          <ThreatIntelPanel sources={otxSources} isAdmin={isAdmin} />
        ))}
    </div>
  );
}
