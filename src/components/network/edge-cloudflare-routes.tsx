"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Cloud, Copy, ExternalLink, Loader2, LockKeyhole, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/components/shared/api-client";
import { copyText } from "@/components/shared/clipboard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OtherEdgeNetwork } from "./edge-networks-types";
import {
  cloudflareIntegrationSummary,
  cloudflarePublishedCountLabel,
  cloudflareTunnelCards,
  cloudflareTunnelCountLabel,
  cloudflareZoneWorthShowing,
  edgeCardsStartExpanded,
  type CloudflareIntegrationSummary,
  type CloudflareRouteRow,
} from "./cloudflare-presentation";
import { CloudflareTunnelCard } from "./edge-cloudflare-tunnel-card";

interface AddRouteTarget {
  integration: OtherEdgeNetwork;
  /** Preselected tunnel when Add route was pressed on a tunnel card. */
  tunnelId: string | null;
}

/**
 * The Cloudflare tab.
 *
 * It is deliberately the SSH edge tab with different nouns: a tunnel is the card
 * that publishes things — the Cloudflare "connector" — and its ingress entries
 * are the routes table beneath it. Integrations group their own tunnels, so an
 * account with two Cloudflare credentials reads as two groups rather than a
 * dropdown that hides one of them.
 */
export function CloudflarePublishedRoutes({ integrations, isAdmin }: { integrations: OtherEdgeNetwork[]; isAdmin: boolean }) {
  const [addFor, setAddFor] = useState<AddRouteTarget | null>(null);
  const [upgradeFor, setUpgradeFor] = useState<OtherEdgeNetwork | null>(null);
  const [removeRoute, setRemoveRoute] = useState<CloudflareRouteRow | null>(null);
  const removeMutation = useRemoveRouteMutation(() => setRemoveRoute(null));
  // One decision for the whole tab: a page showing a handful of tunnels opens
  // them, a page showing a dozen does not.
  const tunnelCount = integrations.reduce((total, integration) => total + cloudflareTunnelCards(integration).length, 0);
  const startExpanded = edgeCardsStartExpanded(tunnelCount);

  return (
    <section className="space-y-5" aria-labelledby="cloudflare-routes-heading">
      <div>
        <h2 id="cloudflare-routes-heading" className="flex items-center gap-2 text-lg font-semibold">
          <Cloud className="size-5" />Cloudflare tunnels
        </h2>
        <p className="text-sm text-muted-foreground">
          Each tunnel publishes hostnames the way an edge box publishes ports. Routes edited here also become evidence
          for the Services catalog.
        </p>
      </div>

      {integrations.map((integration) => (
        <CloudflareIntegrationSection
          key={integration.id}
          integration={integration}
          isAdmin={isAdmin}
          startExpanded={startExpanded}
          onAddRoute={(tunnelId) => setAddFor({ integration, tunnelId })}
          onUpgradeToken={() => setUpgradeFor(integration)}
          onRemoveRoute={setRemoveRoute}
        />
      ))}

      {addFor && (
        <CloudflareRouteDialog
          integration={addFor.integration}
          initialTunnelId={addFor.tunnelId}
          open
          onOpenChange={(open) => !open && setAddFor(null)}
        />
      )}
      {upgradeFor && (
        <CloudflareTokenUpgradeDialog integration={upgradeFor} open onOpenChange={(open) => !open && setUpgradeFor(null)} />
      )}
      <CloudflareRemoveRouteDialog
        route={removeRoute}
        pending={removeMutation.isPending}
        onOpenChange={(open) => !open && setRemoveRoute(null)}
        onConfirm={() => removeRoute?.removable && removeMutation.mutate(removeRoute)}
      />
    </section>
  );
}

/** One Cloudflare account: its strip of state, then a card per tunnel. */
function CloudflareIntegrationSection({
  integration,
  isAdmin,
  startExpanded,
  onAddRoute,
  onUpgradeToken,
  onRemoveRoute,
}: {
  integration: OtherEdgeNetwork;
  isAdmin: boolean;
  startExpanded: boolean;
  onAddRoute: (tunnelId: string | null) => void;
  onUpgradeToken: () => void;
  onRemoveRoute: (route: CloudflareRouteRow) => void;
}) {
  const summary = cloudflareIntegrationSummary(integration);
  const cards = cloudflareTunnelCards(integration);
  const showZone = cloudflareZoneWorthShowing(integration);
  return (
    <section className="space-y-3" aria-label={`${integration.name} tunnels`}>
      <CloudflareIntegrationStrip
        summary={summary}
        isAdmin={isAdmin}
        onAddRoute={() => onAddRoute(null)}
        onUpgradeToken={onUpgradeToken}
      />

      {/* Amber is spent here and nowhere else on this tab: a denied capability is
          the one state that stops a route change from ever succeeding. */}
      {isAdmin && summary.capability === "denied" && (
        <Alert className="border-warning/50 bg-warning/10">
          <LockKeyhole className="text-warning" />
          <AlertTitle>Route changes need an edit-capable Cloudflare token</AlertTitle>
          <AlertDescription>
            The Read All Resources policy is enough for discovery. To add or remove routes, use a token scoped to <strong>Cloudflare Tunnel Edit</strong>, <strong>Zone Read</strong>, and <strong>DNS Edit</strong> for this account and its zones.
          </AlertDescription>
        </Alert>
      )}

      {cards.length === 0 ? (
        <CloudflareNoTunnels summary={summary} />
      ) : (
        cards.map((card) => (
          <CloudflareTunnelCard
            key={card.key}
            card={card}
            isAdmin={isAdmin}
            showZone={showZone}
            defaultExpanded={startExpanded}
            onAddRoute={() => onAddRoute(card.tunnelId)}
            onRemoveRoute={onRemoveRoute}
          />
        ))
      )}
    </section>
  );
}

/** Compact account state, mirroring the fleet strip above the SSH edge cards. */
function CloudflareIntegrationStrip({
  summary,
  isAdmin,
  onAddRoute,
  onUpgradeToken,
}: {
  summary: CloudflareIntegrationSummary;
  isAdmin: boolean;
  onAddRoute: () => void;
  onUpgradeToken: () => void;
}) {
  return (
    <div className="rounded-lg border bg-muted/20">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2">
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm">
          <Cloud className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{summary.name}</span>
          <StripDot />
          <span className="text-muted-foreground">{summary.accountName}</span>
          <StripDot />
          <span className="text-muted-foreground tabular-nums">{cloudflareTunnelCountLabel(summary.tunnelCount)}</span>
          <StripDot />
          <span className="text-muted-foreground tabular-nums">{cloudflarePublishedCountLabel(summary.routeCount)}</span>
        </p>
        {isAdmin && (
          <div className="flex shrink-0 items-center gap-2">
            {summary.capability === "denied" && (
              <Button variant="outline" size="sm" onClick={onUpgradeToken}><LockKeyhole />Upgrade token</Button>
            )}
            <Button size="sm" disabled={!summary.canAddRoute} onClick={onAddRoute}><Plus />Add route</Button>
          </div>
        )}
      </div>
      {/* A disabled button explains itself rather than leaving the operator guessing. */}
      {isAdmin && summary.addRouteBlockedReason && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">{summary.addRouteBlockedReason}</p>
      )}
    </div>
  );
}

function StripDot() {
  return <span className="text-muted-foreground/50" aria-hidden="true">·</span>;
}

/** Nothing to draw a card from: either no tunnels, or a count-only payload. */
function CloudflareNoTunnels({ summary }: { summary: CloudflareIntegrationSummary }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <p className="font-medium">
        {summary.countOnly
          ? `${cloudflareTunnelCountLabel(summary.tunnelCount)} reported, without their routes`
          : "No tunnels were found in the latest sync"}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {summary.countOnly
          ? "This integration last synced before PolySIEM recorded tunnel ingress. Re-sync it to list and edit published hostnames here."
          : "Create a tunnel in Cloudflare, or run cloudflared where it can register, then refresh this page."}
      </p>
    </div>
  );
}

function useRemoveRouteMutation(onRemoved: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (route: CloudflareRouteRow) => apiFetch<{ warning?: string | null }>(`/api/network/edge-networks/cloudflare/${route.integrationId}/routes`, {
      method: "DELETE",
      body: JSON.stringify({ tunnelId: route.tunnelId, zoneId: route.zoneId, hostname: route.hostname }),
    }),
    onSuccess: (result: { warning?: string | null }) => {
      toast.success("Cloudflare published route removed");
      if (result.warning) toast.warning(result.warning);
      onRemoved();
      void queryClient.invalidateQueries({ queryKey: ["edge-networks"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void queryClient.invalidateQueries({ queryKey: ["edge-networks"] });
    },
  });
}

function CloudflareRemoveRouteDialog({
  route,
  pending,
  onOpenChange,
  onConfirm,
}: {
  route: CloudflareRouteRow | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={route !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {route?.hostname}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the ingress rule from {route?.tunnelName ?? "the tunnel"} and its matching CNAME record from Cloudflare. Other tunnel routes and DNS records are preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending || !route?.removable}
            onClick={(event) => { event.preventDefault(); onConfirm(); }}
          >
            {pending && <Loader2 className="animate-spin" />}Remove route
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const CLOUDFLARE_ROUTE_PERMISSION_TEXT = [
  "Account → Cloudflare Tunnel → Edit",
  "Zone → Zone → Read",
  "Zone → DNS → Edit",
  "Account resources → Include → the connected account",
  "Zone resources → Include → only the zones PolySIEM may publish",
].join("\n");

function CloudflareTokenUpgradeDialog({ integration, open, onOpenChange }: { integration: OtherEdgeNetwork; open: boolean; onOpenChange: (open: boolean) => void }) {
  const copyPermissions = async () => {
    try {
      await copyText(CLOUDFLARE_ROUTE_PERMISSION_TEXT);
      toast.success("Permission checklist copied");
    } catch {
      toast.error("Could not copy the permission checklist");
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enable route management for {integration.name}</DialogTitle>
          <DialogDescription>
            Use either path below. PolySIEM never needs permission to create or administer your other Cloudflare API tokens.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div><p className="font-medium">Required token policy</p><p className="mt-1 text-xs text-muted-foreground">Scope it to {integration.account?.name ?? "this account"} and only the zones PolySIEM should publish.</p></div>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyPermissions()}><Copy />Copy</Button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border bg-background p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Account permission</p><p className="mt-1 text-sm font-medium">Cloudflare Tunnel · Edit</p></div>
              <div className="rounded-md border bg-background p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Zone discovery</p><p className="mt-1 text-sm font-medium">Zone · Read</p></div>
              <div className="rounded-md border bg-background p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Zone permission</p><p className="mt-1 text-sm font-medium">DNS · Edit</p></div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col rounded-lg border p-4">
              <Badge variant="secondary" className="mb-3 w-fit">Fastest</Badge>
              <h3 className="font-medium">Edit the current token</h3>
              <ol className="mt-2 flex-1 list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
                <li>Open Cloudflare API Tokens and choose the token used by this integration.</li>
                <li>Edit its policies and add the two permissions above.</li>
                <li>Save it, return here, and retry Add route. The stored token secret normally stays valid.</li>
              </ol>
              <Button className="mt-4" variant="outline" asChild>
                <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">Edit current token <ExternalLink /></a>
              </Button>
            </div>
            <div className="flex flex-col rounded-lg border p-4">
              <Badge variant="outline" className="mb-3 w-fit">Clean replacement</Badge>
              <h3 className="font-medium">Create a dedicated token</h3>
              <ol className="mt-2 flex-1 list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
                <li>Create a Custom Token with the two permissions above.</li>
                <li>Restrict account and zone resources, then copy the secret shown once.</li>
                <li>Use the button below to open this exact integration with credential replacement ready.</li>
              </ol>
              <div className="mt-4 grid gap-2">
                <Button variant="outline" asChild><a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">Create token <ExternalLink /></a></Button>
                <Button asChild><Link href={`/settings/integrations?edit=${encodeURIComponent(integration.id)}&upgrade=cloudflare-routes`}>Paste replacement token <ArrowRight /></Link></Button>
              </div>
            </div>
          </div>

          <Alert>
            <ShieldCheck />
            <AlertTitle>Least privilege stays intact</AlertTitle>
            <AlertDescription>Do not add API Tokens Edit or Account API Tokens Write. Those permissions manage credentials themselves and are not needed for tunnel routes or DNS.</AlertDescription>
          </Alert>
        </div>
        <DialogFooter><DialogClose asChild><Button type="button" variant="outline">Done</Button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloudflareRouteDialog({
  integration,
  initialTunnelId,
  open,
  onOpenChange,
}: {
  integration: OtherEdgeNetwork;
  /** The tunnel whose card opened this dialog, when one did. */
  initialTunnelId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const tunnels = cloudflareTunnelCards(integration).filter((card) => card.config.editable && card.tunnelId);
  const zones = integration.zones ?? [];
  const [tunnelId, setTunnelId] = useState(initialTunnelId ?? tunnels[0]?.tunnelId ?? "");
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? "");
  const [hostname, setHostname] = useState("");
  const [service, setService] = useState("http://");
  const [path, setPath] = useState("");
  const selectedZone = zones.find((zone) => zone.id === zoneId);
  const mutation = useMutation({
    mutationFn: () => apiFetch<{ warning?: string | null }>(`/api/network/edge-networks/cloudflare/${integration.id}/routes`, {
      method: "POST",
      body: JSON.stringify({ tunnelId, zoneId, hostname: hostname.trim(), service: service.trim(), path: path.trim() }),
    }),
    onSuccess: (result: { warning?: string | null }) => {
      toast.success(`Published ${hostname.trim()} through Cloudflare`);
      if (result.warning) toast.warning(result.warning);
      void queryClient.invalidateQueries({ queryKey: ["edge-networks"] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void queryClient.invalidateQueries({ queryKey: ["edge-networks"] });
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
          <DialogHeader><DialogTitle>Add a Cloudflare hostname route</DialogTitle><DialogDescription>PolySIEM adds the tunnel ingress rule and a proxied CNAME pointing to the selected tunnel.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-5">
            <div className="grid gap-2"><Label htmlFor="cf-route-tunnel">Tunnel</Label><Select value={tunnelId} onValueChange={setTunnelId}><SelectTrigger id="cf-route-tunnel"><SelectValue placeholder="Choose a remotely managed tunnel" /></SelectTrigger><SelectContent>{tunnels.map((tunnel) => <SelectItem key={tunnel.key} value={tunnel.tunnelId!}>{tunnel.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-2"><Label htmlFor="cf-route-zone">DNS zone</Label><Select value={zoneId} onValueChange={setZoneId}><SelectTrigger id="cf-route-zone"><SelectValue placeholder="Choose a zone" /></SelectTrigger><SelectContent>{zones.map((zone) => <SelectItem key={zone.id} value={zone.id}>{zone.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-2"><Label htmlFor="cf-route-hostname">Published hostname</Label><Input id="cf-route-hostname" value={hostname} onChange={(event) => setHostname(event.target.value)} placeholder={selectedZone ? `app.${selectedZone.name}` : "app.example.com"} required /><p className="text-xs text-muted-foreground">Enter the complete hostname in the selected zone.</p></div>
            <div className="grid gap-2"><Label htmlFor="cf-route-service">Origin service</Label><Input id="cf-route-service" value={service} onChange={(event) => setService(event.target.value)} placeholder="http://10.0.3.20:8080" required /><p className="text-xs text-muted-foreground">The address cloudflared can reach inside the lab.</p></div>
            <div className="grid gap-2"><Label htmlFor="cf-route-path">Path filter (optional)</Label><Input id="cf-route-path" value={path} onChange={(event) => setPath(event.target.value)} placeholder="/api/*" /></div>
          </div>
          <DialogFooter><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose><Button type="submit" disabled={mutation.isPending || !tunnelId || !zoneId}>{mutation.isPending && <Loader2 className="animate-spin" />}Publish route</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
