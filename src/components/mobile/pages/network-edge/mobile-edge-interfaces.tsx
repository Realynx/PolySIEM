"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MobileKeyRow, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import {
  edgeInterfaceChoices,
  edgeInterfaceOptions,
  isValidEdgeInterfaceName,
  EDGE_NETWORKS_QUERY_KEY,
  type EdgeNatServer,
} from "@/components/network/edge-networks-types";
import { MobileSelectField } from "./mobile-form-controls";
import { edgeForwardingLabel } from "./mobile-edge-sync";

/** The interface facts the panel shows, preferring the edge's last synced snapshot. */
function edgeInterfaceFacts(server: EdgeNatServer): {
  publicInterface: string;
  outboundInterface: string;
  publicIp: string;
} {
  const settings = server.settings ?? {};
  return {
    publicInterface: settings.publicInterface ?? "eth0",
    outboundInterface: settings.outboundInterface ?? "tailscale0",
    publicIp: settings.syncedSnapshot?.publicIp ?? settings.publicIp ?? "Not detected",
  };
}

/** The Interfaces tab: the edge's own plumbing — where traffic lands and leaves. */
export function EdgeInterfacesPanel({ server, isAdmin }: { server: EdgeNatServer; isAdmin: boolean }) {
  const [editing, setEditing] = useState(false);
  const { publicInterface, outboundInterface, publicIp } = edgeInterfaceFacts(server);
  const detected = edgeInterfaceOptions(server);

  return (
    <>
      <MobileList>
        {isAdmin ? (
          <MobileListRow
            onClick={() => setEditing(true)}
            title="Interfaces"
            subtitle={
              <span className="font-mono">
                {publicInterface} → {outboundInterface}
              </span>
            }
            trailing={<Pencil className="size-3.5" />}
          />
        ) : (
          <MobileKeyRow label="Interfaces" mono>
            {publicInterface} → {outboundInterface}
          </MobileKeyRow>
        )}
        <MobileKeyRow label="IP forwarding">{edgeForwardingLabel(server)}</MobileKeyRow>
        <MobileKeyRow label="Detected on edge">
          {detected.length > 0 ? `${detected.length} interfaces` : "Not synced yet"}
        </MobileKeyRow>
        <MobileKeyRow label="Public IP" mono>
          {publicIp}
        </MobileKeyRow>
      </MobileList>
      <p className="px-0.5 text-[11px] text-muted-foreground">
        Real Linux interface names: where published traffic arrives, then which one carries it toward the target.
      </p>

      {editing && <MobileEdgeInterfacesSheet server={server} onOpenChange={setEditing} />}
    </>
  );
}

/**
 * Edge NAT interface configuration. Both fields describe a traffic role, not a
 * trust zone, and both are real Linux interface names — so they are dropdowns
 * populated from the interfaces the edge actually reported in its last synced
 * snapshot, with a Custom… escape hatch for anything not in that list (and a
 * plain text input when no snapshot exists yet).
 */
function MobileEdgeInterfacesSheet({
  server,
  onOpenChange,
}: {
  server: EdgeNatServer;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const settings = server.settings ?? {};
  const [publicInterface, setPublicInterface] = useState(settings.publicInterface ?? "eth0");
  const [outboundInterface, setOutboundInterface] = useState(settings.outboundInterface ?? "tailscale0");
  const [forwarding, setForwarding] = useState(settings.enableIpForwarding ?? true);

  // The edge's REAL interfaces, parsed from its last synced snapshot by the
  // shared helper (plus the configured WireGuard interface when it is missing).
  const choices = edgeInterfaceChoices(server);
  const publicValid = isValidEdgeInterfaceName(publicInterface);
  const outboundValid = isValidEdgeInterfaceName(outboundInterface);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/admin/integrations/${server.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            publicInterface: publicInterface.trim(),
            outboundInterface: outboundInterface.trim(),
            enableIpForwarding: forwarding,
          },
        }),
      }),
    onSuccess: () => {
      toast.success("Interfaces saved. Apply rules to push the change.");
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(`Could not save the interfaces: ${error.message}`),
  });

  const save = () => {
    if (!publicValid || !outboundValid) {
      toast.error("Use Linux interface names, for example eth0 or wg0.");
      return;
    }
    mutation.mutate();
  };

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`Interfaces — ${server.name}`}
      description="Where published traffic arrives, and which interface carries it toward the target."
    >
      <div className="flex flex-col gap-4 pb-2">
        {choices.length > 0 ? (
          <>
            <MobileSelectField
              id="m-edge-public-if"
              label="Listener interface"
              value={publicInterface}
              onChange={setPublicInterface}
              choices={choices}
              mono
              invalid={!publicValid}
              customPlaceholder="eth0"
              help="The interface published traffic arrives on — usually the one holding the edge's public address."
            />
            <MobileSelectField
              id="m-edge-outbound-if"
              label="Target-path interface"
              value={outboundInterface}
              onChange={setOutboundInterface}
              choices={choices}
              mono
              invalid={!outboundValid}
              customPlaceholder="wg0"
              help="The interface the route to the target uses. It may be the same interface, or a tunnel such as wg0."
            />
          </>
        ) : (
          <EdgeInterfaceTextFields
            publicInterface={publicInterface}
            outboundInterface={outboundInterface}
            publicValid={publicValid}
            outboundValid={outboundValid}
            onPublicChange={setPublicInterface}
            onOutboundChange={setOutboundInterface}
          />
        )}

        <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
          <div>
            <Label htmlFor="m-edge-forwarding">IP forwarding</Label>
            <p className="text-xs text-muted-foreground">Required for the edge to forward published traffic at all.</p>
          </div>
          <Switch id="m-edge-forwarding" checked={forwarding} onCheckedChange={setForwarding} />
        </div>

        <Button className="w-full" disabled={mutation.isPending || !publicValid || !outboundValid} onClick={save}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <Check />} Save interfaces
        </Button>
      </div>
    </BottomSheet>
  );
}

/** Free-text fallback for an edge that has never reported its interfaces. */
function EdgeInterfaceTextFields({
  publicInterface,
  outboundInterface,
  publicValid,
  outboundValid,
  onPublicChange,
  onOutboundChange,
}: {
  publicInterface: string;
  outboundInterface: string;
  publicValid: boolean;
  outboundValid: boolean;
  onPublicChange: (value: string) => void;
  onOutboundChange: (value: string) => void;
}) {
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="m-edge-public-if">Listener interface</Label>
        <Input
          id="m-edge-public-if"
          value={publicInterface}
          onChange={(event) => onPublicChange(event.target.value)}
          placeholder="eth0"
          autoCapitalize="none"
          spellCheck={false}
          className={cn("font-mono", !publicValid && "border-destructive")}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="m-edge-outbound-if">Target-path interface</Label>
        <Input
          id="m-edge-outbound-if"
          value={outboundInterface}
          onChange={(event) => onOutboundChange(event.target.value)}
          placeholder="wg0"
          autoCapitalize="none"
          spellCheck={false}
          className={cn("font-mono", !outboundValid && "border-destructive")}
        />
      </div>
      <p className="rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground">
        This edge has not reported its interfaces yet, so these stay free text. Sync the server and the real interfaces
        become selectable.
      </p>
    </>
  );
}
