"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Cloud, Copy, ExternalLink, Loader2, LockKeyhole, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/components/shared/api-client";
import { copyText } from "@/components/shared/clipboard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { OtherEdgeNetwork } from "./edge-networks-types";
import { cloudflareZoneForHostname } from "./edge-network-utils";

interface PublishedRouteRow {
  integrationId: string;
  tunnelId: string;
  tunnelName: string;
  hostname: string;
  service: string;
  path: string;
  zoneId: string | null;
}

export function CloudflarePublishedRoutes({ integrations, isAdmin }: { integrations: OtherEdgeNetwork[]; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [selectedIntegrationId, setSelectedIntegrationId] = useState(integrations[0]?.id ?? "");
  const [addFor, setAddFor] = useState<OtherEdgeNetwork | null>(null);
  const [upgradeFor, setUpgradeFor] = useState<OtherEdgeNetwork | null>(null);
  const [removeRoute, setRemoveRoute] = useState<PublishedRouteRow | null>(null);
  const selectedIntegration = integrations.find((network) => network.id === selectedIntegrationId) ?? integrations[0];
  const tunnels = selectedIntegration && Array.isArray(selectedIntegration.tunnels) ? selectedIntegration.tunnels : [];
  const editableTunnels = tunnels.filter((tunnel) => tunnel.configSource === "cloudflare");
  const rows = selectedIntegration && Array.isArray(selectedIntegration.tunnels)
    ? selectedIntegration.tunnels.flatMap((tunnel) => (tunnel.ingress ?? []).flatMap((ingress) => {
        if (!tunnel.id || !ingress.hostname) return [];
        return [{
          integrationId: selectedIntegration.id,
          tunnelId: tunnel.id,
          tunnelName: tunnel.name,
          hostname: ingress.hostname,
          service: ingress.service,
          path: ingress.path ?? "",
          zoneId: cloudflareZoneForHostname(selectedIntegration, ingress.hostname)?.id ?? null,
        }];
      }))
    : [];
  const removeMutation = useMutation({
    mutationFn: (route: PublishedRouteRow) => apiFetch<{ warning?: string | null }>(`/api/network/edge-networks/cloudflare/${route.integrationId}/routes`, {
      method: "DELETE",
      body: JSON.stringify({ tunnelId: route.tunnelId, zoneId: route.zoneId, hostname: route.hostname }),
    }),
    onSuccess: (result: { warning?: string | null }) => {
      toast.success("Cloudflare published route removed");
      if (result.warning) toast.warning(result.warning);
      setRemoveRoute(null);
      void queryClient.invalidateQueries({ queryKey: ["edge-networks"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void queryClient.invalidateQueries({ queryKey: ["edge-networks"] });
    },
  });

  return (
    <section className="space-y-3" aria-labelledby="cloudflare-routes-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="cloudflare-routes-heading" className="flex items-center gap-2 text-lg font-semibold"><Cloud className="size-5" />Cloudflare published routes</h2>
          <p className="text-sm text-muted-foreground">Manage public hostnames here; each observed route also becomes evidence for the Services catalog.</p>
        </div>
        {integrations.length > 1 && (
          <div className="grid min-w-64 gap-1.5">
            <Label htmlFor="cloudflare-integration" className="text-xs text-muted-foreground">Cloudflare integration</Label>
            <Select value={selectedIntegration?.id} onValueChange={setSelectedIntegrationId}>
              <SelectTrigger id="cloudflare-integration" className="w-full bg-background">
                <SelectValue placeholder="Choose an integration" />
              </SelectTrigger>
              <SelectContent>
                {integrations.map((network) => (
                  <SelectItem key={network.id} value={network.id}>
                    {network.name}{network.account?.name && network.account.name !== network.name ? ` · ${network.account.name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {isAdmin && selectedIntegration?.routeManagementCapability?.status === "denied" && (
        <Alert className="border-warning/50 bg-warning/10">
          <LockKeyhole className="text-warning" />
          <AlertTitle>Route changes need an edit-capable Cloudflare token</AlertTitle>
          <AlertDescription>
            The Read All Resources policy is enough for discovery. To add or remove routes, use a token scoped to <strong>Cloudflare Tunnel Edit</strong>, <strong>Zone Read</strong>, and <strong>DNS Edit</strong> for the selected account and zones.
          </AlertDescription>
        </Alert>
      )}
      {selectedIntegration && (
        <Card size="sm">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{selectedIntegration.name}</CardTitle>
                <CardDescription>{selectedIntegration.account?.name ?? "Cloudflare account"} · {tunnels.length} tunnel{tunnels.length === 1 ? "" : "s"} · {rows.length} published hostname{rows.length === 1 ? "" : "s"}</CardDescription>
              </div>
              {isAdmin && <div className="flex flex-wrap justify-end gap-2">
                {selectedIntegration.routeManagementCapability?.status === "denied" && <Button variant="outline" size="sm" onClick={() => setUpgradeFor(selectedIntegration)}><LockKeyhole />Upgrade token</Button>}
                <Button size="sm" disabled={editableTunnels.length === 0 || !(selectedIntegration.zones?.length)} onClick={() => setAddFor(selectedIntegration)}><Plus />Add route</Button>
              </div>}
            </div>
          </CardHeader>
          <CardContent>
            {tunnels.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {tunnels.map((tunnel) => <div key={tunnel.id ?? tunnel.name} className="flex min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"><span className="truncate font-medium">{tunnel.name}</span><div className="flex shrink-0 items-center gap-2"><Badge variant="outline">{tunnel.status ?? "unknown"}</Badge><Badge variant={tunnel.configSource === "cloudflare" ? "secondary" : "outline"}>{tunnel.configSource === "cloudflare" ? "remote" : "local"}</Badge></div></div>)}
              </div>
            ) : <p className="text-sm text-muted-foreground">No tunnels were found in the latest sync.</p>}
            {tunnels.length > 0 && editableTunnels.length === 0 && <p className="mt-2 text-xs text-warning">Local YAML tunnel configurations are read-only here; move the tunnel to remote configuration before editing routes.</p>}
          </CardContent>
        </Card>
      )}
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Hostname</TableHead><TableHead>Tunnel</TableHead><TableHead>Origin service</TableHead>{isAdmin && <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>}</TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableRow><TableCell colSpan={isAdmin ? 4 : 3} className="py-8 text-center text-muted-foreground">No published hostname routes found.</TableCell></TableRow> : rows.map((route) => (
              <TableRow key={`${route.integrationId}:${route.tunnelId}:${route.hostname}`}>
                <TableCell className="font-medium">{route.hostname}{route.path && <span className="font-normal text-muted-foreground">{route.path}</span>}</TableCell>
                <TableCell>{route.tunnelName}</TableCell>
                <TableCell className="font-mono text-xs">{route.service}</TableCell>
                {isAdmin && <TableCell><Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" disabled={!route.zoneId} aria-label={`Remove ${route.hostname}`} onClick={() => setRemoveRoute(route)}><Trash2 /></Button></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {addFor && <CloudflareRouteDialog integration={addFor} open onOpenChange={(open) => !open && setAddFor(null)} />}
      {upgradeFor && <CloudflareTokenUpgradeDialog integration={upgradeFor} open onOpenChange={(open) => !open && setUpgradeFor(null)} />}
      <AlertDialog open={removeRoute !== null} onOpenChange={(open) => !open && setRemoveRoute(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remove {removeRoute?.hostname}?</AlertDialogTitle><AlertDialogDescription>This removes the tunnel ingress rule and its matching CNAME record from Cloudflare. Other tunnel routes and DNS records are preserved.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={removeMutation.isPending || !removeRoute?.zoneId} onClick={(event) => { event.preventDefault(); if (removeRoute?.zoneId) removeMutation.mutate(removeRoute); }}>{removeMutation.isPending && <Loader2 className="animate-spin" />}Remove route</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
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

function CloudflareRouteDialog({ integration, open, onOpenChange }: { integration: OtherEdgeNetwork; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const tunnels = Array.isArray(integration.tunnels) ? integration.tunnels.filter((tunnel) => tunnel.id && tunnel.configSource === "cloudflare") : [];
  const zones = integration.zones ?? [];
  const [tunnelId, setTunnelId] = useState(tunnels[0]?.id ?? "");
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
            <div className="grid gap-2"><Label htmlFor="cf-route-tunnel">Tunnel</Label><Select value={tunnelId} onValueChange={setTunnelId}><SelectTrigger id="cf-route-tunnel"><SelectValue placeholder="Choose a remotely managed tunnel" /></SelectTrigger><SelectContent>{tunnels.map((tunnel) => <SelectItem key={tunnel.id} value={tunnel.id!}>{tunnel.name}</SelectItem>)}</SelectContent></Select></div>
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
