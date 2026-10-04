"use client";

import Link from "next/link";
import { ExternalLink, Network, Plus, Share2 } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { tailscaleDetails, type EdgeNetworksOverview } from "./edge-networks-types";

export function TailscaleTab({
  networks,
  isAdmin,
}: {
  networks: EdgeNetworksOverview["tailscale"];
  isAdmin: boolean;
}) {
  if (networks.length === 0) {
    return (
      <EdgeNetworkTabEmpty
        icon={Share2}
        title="No Tailscale integration"
        description="Connect a tailnet to inventory private routes, exit nodes, devices, and DNS identity."
        addHref="/settings/integrations?add=TAILSCALE"
        addLabel="Connect Tailscale"
        isAdmin={isAdmin}
      />
    );
  }
  return (
    <section className="space-y-3" aria-labelledby="tailscale-edge-heading">
      <div>
        <h2 id="tailscale-edge-heading" className="text-lg font-semibold">Tailscale</h2>
        <p className="text-sm text-muted-foreground">Private overlay entry points, subnet routes, exit nodes, and DNS identity.</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {networks.map((network, index) => (
          <TailscaleCard key={network.id ?? network.integrationId ?? index} network={network} />
        ))}
      </div>
    </section>
  );
}

export function EdgeNetworkTabEmpty({
  icon,
  title,
  description,
  addHref,
  addLabel,
  isAdmin,
}: {
  icon: typeof Share2;
  title: string;
  description: string;
  addHref: string;
  addLabel: string;
  isAdmin: boolean;
}) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={description}
      action={isAdmin ? (
        <Button asChild>
          <Link href={addHref}><Plus className="size-4" /> {addLabel}</Link>
        </Button>
      ) : undefined}
    />
  );
}

function ServerFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className={cn("mt-0.5 truncate font-medium", mono && "font-mono text-xs")}>{value}</p></div>;
}

function TailscaleCard({ network }: { network: EdgeNetworksOverview["tailscale"][number] }) {
  const details = tailscaleDetails(network);
  return (
    <Card>
      <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><Network className="size-4" />{network.name ?? network.tailnet ?? "Tailscale"}</CardTitle><CardDescription>{details.domain ?? "Tailnet domain not discovered"}</CardDescription></div>{details.magicDnsEnabled !== undefined && <Badge variant="outline">MagicDNS {details.magicDnsEnabled ? "on" : "off"}</Badge>}</div></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><ServerFact label="Devices" value={String(details.deviceCount)} /><ServerFact label="Online" value={String(details.onlineDeviceCount)} /><ServerFact label="Subnet routes" value={String(details.subnetRoutes.length)} /><ServerFact label="Exit nodes" value={String(details.exitNodes.length)} /></div>
        {details.subnetRoutes.length > 0 && <div><p className="mb-2 text-xs font-medium text-muted-foreground">Private routes</p><div className="flex flex-wrap gap-1.5">{details.subnetRoutes.map((route) => <Badge key={route} variant="secondary" className="font-mono font-normal">{route}</Badge>)}</div></div>}
        {details.exitNodes.length > 0 && <div><p className="mb-2 text-xs font-medium text-muted-foreground">Internet entry points</p><div className="flex flex-wrap gap-1.5">{details.exitNodes.map((node) => <Badge key={node.name} variant="outline"><ExternalLink className="size-3" />{node.name}{node.online === false ? " · offline" : ""}</Badge>)}</div></div>}
        {details.nameservers.length > 0 && <p className="text-xs text-muted-foreground">DNS: <span className="font-mono text-foreground">{details.nameservers.join(", ")}</span></p>}
      </CardContent>
    </Card>
  );
}
