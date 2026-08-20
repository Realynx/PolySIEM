"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/components/shared/api-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileKeyRow, MobileList } from "@/components/mobile/ui/mobile-list";
import {
  cloudflarePathLabel,
  cloudflareServiceLabel,
  cloudflareTunnelCards,
  type CloudflareRouteRow,
} from "@/components/network/cloudflare-presentation";
import { EDGE_NETWORKS_QUERY_KEY, type OtherEdgeNetwork } from "@/components/network/edge-networks-types";
import { MobileCopyRow } from "./mobile-connector-atoms";

/**
 * Every sheet the Cloudflare tab opens.
 *
 * Routes are listed from one place per tunnel but acted on from one place
 * overall: the panel mounts these with the selected route or integration, so a
 * route removed from a tunnel card and a route removed from anywhere else can
 * never behave differently.
 */

const CLOUDFLARE_ROUTES_URL = (integrationId: string) =>
  `/api/network/edge-networks/cloudflare/${integrationId}/routes`;

/** Both route mutations refresh the same overview the whole page reads. */
function useRouteMutation<TInput>(
  request: (input: TInput) => Promise<{ warning?: string | null }>,
  success: (input: TInput) => string,
  onDone: () => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (result: { warning?: string | null }, input: TInput) => {
      toast.success(success(input));
      if (result.warning) toast.warning(result.warning);
      onDone();
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
    },
  });
}

/** One published hostname in full, and the one action it offers. */
export function MobileCloudflareRouteSheet({
  route,
  isAdmin,
  onOpenChange,
  onRemove,
}: {
  route: CloudflareRouteRow | null;
  isAdmin: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove: (route: CloudflareRouteRow) => void;
}) {
  return (
    <BottomSheet
      open={route !== null}
      onOpenChange={onOpenChange}
      title={route?.hostname ?? "Published route"}
      description={route ? `Tunnel ingress on ${route.tunnelName}` : undefined}
    >
      {route && (
        <div className="flex flex-col gap-3 pb-2">
          <MobileList>
            <MobileKeyRow label="Hostname" mono>
              {route.hostname}
            </MobileKeyRow>
            <MobileKeyRow label="Tunnel">{route.tunnelName}</MobileKeyRow>
            <MobileKeyRow label="Path" mono={route.path !== ""}>
              {cloudflarePathLabel(route.path)}
            </MobileKeyRow>
            <MobileKeyRow label="Origin service" mono>
              {cloudflareServiceLabel(route.service)}
            </MobileKeyRow>
            <MobileKeyRow label="Zone">{route.zoneName ?? "No matching zone"}</MobileKeyRow>
          </MobileList>
          {isAdmin && <RouteRemoveAction route={route} onRemove={onRemove} />}
        </div>
      )}
    </BottomSheet>
  );
}

/**
 * `removable` is the single gate: PolySIEM can only delete a route it can
 * address, and when it cannot the reason is stated rather than left to a
 * disabled button.
 */
function RouteRemoveAction({
  route,
  onRemove,
}: {
  route: CloudflareRouteRow;
  onRemove: (route: CloudflareRouteRow) => void;
}) {
  if (!route.removable) {
    return (
      <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">
        PolySIEM needs this tunnel&apos;s id and a matching DNS zone to remove the route, and the last sync reported
        one of them missing. The route stays published until it is removed where it is configured.
      </p>
    );
  }
  return (
    <Button variant="destructive" className="w-full" onClick={() => onRemove(route)}>
      <Trash2 /> Remove route
    </Button>
  );
}

export function MobileCloudflareRemoveDialog({
  route,
  onOpenChange,
  onRemoved,
}: {
  route: CloudflareRouteRow | null;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  const mutation = useRouteMutation(
    (target: CloudflareRouteRow) =>
      apiFetch<{ warning?: string | null }>(CLOUDFLARE_ROUTES_URL(target.integrationId), {
        method: "DELETE",
        body: JSON.stringify({ tunnelId: target.tunnelId, zoneId: target.zoneId, hostname: target.hostname }),
      }),
    () => "Cloudflare published route removed",
    onRemoved,
  );
  return (
    <AlertDialog open={route !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {route?.hostname}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the ingress rule from {route?.tunnelName ?? "the tunnel"} and its matching CNAME record from
            Cloudflare. Other tunnel routes and DNS records are preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending || !route?.removable}
            onClick={(event) => {
              event.preventDefault();
              if (route?.removable) mutation.mutate(route);
            }}
          >
            {mutation.isPending && <Loader2 className="animate-spin" />}
            Remove route
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface AddRouteForm {
  tunnelId: string;
  zoneId: string;
  hostname: string;
  service: string;
  path: string;
}

/** Publish a hostname through one tunnel: the phone form for the desktop dialog. */
export function MobileCloudflareAddRouteSheet({
  integration,
  initialTunnelId,
  onOpenChange,
}: {
  integration: OtherEdgeNetwork;
  /** The tunnel whose card opened this sheet, when one did. */
  initialTunnelId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  // Only tunnels PolySIEM may actually edit — a local config file is edited
  // where that file lives, not from here.
  const tunnels = cloudflareTunnelCards(integration).filter((card) => card.config.editable && card.tunnelId);
  const zones = integration.zones ?? [];
  const [form, setForm] = useState<AddRouteForm>(() => ({
    tunnelId: initialTunnelId ?? tunnels[0]?.tunnelId ?? "",
    zoneId: zones[0]?.id ?? "",
    hostname: "",
    service: "http://",
    path: "",
  }));
  const update = (patch: Partial<AddRouteForm>) => setForm((current) => ({ ...current, ...patch }));
  const mutation = useRouteMutation(
    (input: AddRouteForm) =>
      apiFetch<{ warning?: string | null }>(CLOUDFLARE_ROUTES_URL(integration.id), {
        method: "POST",
        body: JSON.stringify({
          tunnelId: input.tunnelId,
          zoneId: input.zoneId,
          hostname: input.hostname.trim(),
          service: input.service.trim(),
          path: input.path.trim(),
        }),
      }),
    (input) => `Published ${input.hostname.trim()} through Cloudflare`,
    () => onOpenChange(false),
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.hostname.trim() || !form.service.trim()) {
      toast.error("Enter the complete hostname and the service cloudflared can reach.");
      return;
    }
    mutation.mutate(form);
  };

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title="Add a hostname route"
      description={`PolySIEM adds the tunnel ingress rule and a proxied CNAME on ${integration.name}.`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4 pb-2">
        <div className="grid gap-1.5">
          <Label>Tunnel</Label>
          <Select value={form.tunnelId} onValueChange={(tunnelId) => update({ tunnelId })}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a remotely managed tunnel" />
            </SelectTrigger>
            <SelectContent>
              {tunnels.map((tunnel) => (
                <SelectItem key={tunnel.key} value={tunnel.tunnelId ?? ""}>
                  {tunnel.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>DNS zone</Label>
          <Select value={form.zoneId} onValueChange={(zoneId) => update({ zoneId })}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a zone" />
            </SelectTrigger>
            <SelectContent>
              {zones.map((zone) => (
                <SelectItem key={zone.id} value={zone.id}>
                  {zone.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <AddRouteFields form={form} zoneName={zones.find((zone) => zone.id === form.zoneId)?.name} update={update} />
        <Button type="submit" className="w-full" disabled={mutation.isPending || !form.tunnelId || !form.zoneId}>
          {mutation.isPending && <Loader2 className="animate-spin" />}
          Publish route
        </Button>
      </form>
    </BottomSheet>
  );
}

function AddRouteFields({
  form,
  zoneName,
  update,
}: {
  form: AddRouteForm;
  zoneName: string | undefined;
  update: (patch: Partial<AddRouteForm>) => void;
}) {
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="m-cf-hostname">Published hostname</Label>
        <Input
          id="m-cf-hostname"
          value={form.hostname}
          onChange={(event) => update({ hostname: event.target.value })}
          placeholder={zoneName ? `app.${zoneName}` : "app.example.com"}
          autoCapitalize="none"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">Enter the complete hostname in the selected zone.</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="m-cf-service">Origin service</Label>
        <Input
          id="m-cf-service"
          value={form.service}
          onChange={(event) => update({ service: event.target.value })}
          placeholder="http://10.0.3.20:8080"
          autoCapitalize="none"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">The address cloudflared can reach inside the lab.</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="m-cf-path">
          Path filter <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="m-cf-path"
          value={form.path}
          onChange={(event) => update({ path: event.target.value })}
          placeholder="/api/*"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>
    </>
  );
}

/**
 * The three scopes a route-managing token needs, used both as the rows below and
 * as the checklist the copy row puts on the clipboard.
 */
const CLOUDFLARE_ROUTE_PERMISSIONS: ReadonlyArray<{ label: string; policy: string }> = [
  { label: "Account permission", policy: "Cloudflare Tunnel · Edit" },
  { label: "Zone discovery", policy: "Zone · Read" },
  { label: "Zone permission", policy: "DNS · Edit" },
];

/** What to change in Cloudflare so route management stops being denied. */
export function MobileCloudflareTokenSheet({
  integration,
  onOpenChange,
}: {
  integration: OtherEdgeNetwork;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title="Enable route management"
      description={`Scope the token to ${integration.account?.name ?? "this account"} and only the zones PolySIEM should publish.`}
    >
      <div className="flex flex-col gap-3 pb-2">
        <MobileList>
          {CLOUDFLARE_ROUTE_PERMISSIONS.map((permission) => (
            <MobileKeyRow key={permission.label} label={permission.label}>
              {permission.policy}
            </MobileKeyRow>
          ))}
        </MobileList>
        <MobileCopyRow
          label="Token policy"
          value={CLOUDFLARE_ROUTE_PERMISSIONS.map((permission) => permission.policy).join("\n")}
          display={CLOUDFLARE_ROUTE_PERMISSIONS.map((permission) => permission.policy).join(", ")}
        />
        <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">
          Adding these two permissions to the token this integration already uses is the fastest path — the stored
          secret normally stays valid. A dedicated replacement token works too; paste it into the integration.
        </p>
        <Button variant="outline" className="w-full" asChild>
          <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">
            Open Cloudflare API tokens <ExternalLink />
          </a>
        </Button>
        <Button className="w-full" asChild>
          <Link href={`/settings/integrations?edit=${encodeURIComponent(integration.id)}&upgrade=cloudflare-routes`}>
            Paste replacement token <ArrowRight />
          </Link>
        </Button>
        <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">
          Do not add API Tokens Edit or Account API Tokens Write. Those manage credentials themselves and are not
          needed for tunnel routes or DNS.
        </p>
      </div>
    </BottomSheet>
  );
}
