"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { expandVlanSpec } from "@/lib/switch/cisco";
import { MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileKeyRow, MobileList } from "@/components/mobile/ui/mobile-list";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { cn } from "@/lib/utils";

/** Serializable slice of a switch port for the phone port lists. */
export interface MobileSwitchPort {
  id: string;
  shortName: string;
  name: string;
  description: string | null;
  mode: string | null;
  accessVlanId: number | null;
  voiceVlanId: number | null;
  nativeVlanId: number | null;
  allowedVlans: string | null;
  channelGroup: number | null;
  channelMode: string | null;
  isPortChannel: boolean;
  isShutdown: boolean;
  ipAddress: string | null;
  connectedDevice: { id: string; name: string } | null;
}

function ModeBadge({ mode }: { mode: string | null }) {
  if (mode === "access") return <Badge variant="secondary" className="text-[10px]">access</Badge>;
  if (mode === "trunk") return <Badge className="text-[10px]">trunk</Badge>;
  if (mode === "routed") return <Badge variant="outline" className="text-[10px]">routed</Badge>;
  return (
    <Badge variant="outline" className="text-[10px] text-muted-foreground">
      unknown
    </Badge>
  );
}

/** Compact VLAN/address summary matching the desktop PortVlans column. */
function vlanSummary(port: MobileSwitchPort): string {
  if (port.mode === "routed" && port.ipAddress) return port.ipAddress;
  if (port.mode === "trunk") return port.allowedVlans ?? "all VLANs";
  if (port.accessVlanId == null && port.voiceVlanId == null) return "—";
  return `${port.accessVlanId ?? "—"}${port.voiceVlanId != null ? ` · voice ${port.voiceVlanId}` : ""}`;
}

function allowedVlanText(spec: string | null): string {
  if (spec === null) return "all VLANs";
  const ids = expandVlanSpec(spec);
  return ids.length > 0 && ids.length <= 24 ? ids.join(", ") : spec;
}

function PortRow({ port, onOpen }: { port: MobileSwitchPort; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex min-h-13 w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors active:bg-muted/70",
        port.isShutdown && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm leading-tight font-medium">
          <span className="font-mono text-xs">{port.shortName}</span>
          {port.isShutdown && (
            <Badge variant="destructive" className="text-[10px]">
              shut
            </Badge>
          )}
        </div>
        {(port.description || port.connectedDevice) && (
          <div className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">
            {port.description ?? port.connectedDevice?.name}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <ModeBadge mode={port.mode} />
        <span className="max-w-32 truncate font-mono text-[11px] text-muted-foreground tabular-nums">
          {vlanSummary(port)}
        </span>
      </div>
    </button>
  );
}

/**
 * Phone port + port-channel lists for a switch: tappable rows opening a bottom
 * sheet with the full port detail (mode, VLANs, addresses, channel, device).
 */
export function MobileSwitchPorts({
  physicalPorts,
  portChannels,
  membersByChannel,
}: {
  physicalPorts: MobileSwitchPort[];
  portChannels: MobileSwitchPort[];
  /** Member ports keyed by the port-channel's id. */
  membersByChannel: Record<string, MobileSwitchPort[]>;
}) {
  const [selected, setSelected] = useState<MobileSwitchPort | null>(null);
  const members = selected?.isPortChannel ? (membersByChannel[selected.id] ?? []) : [];

  return (
    <>
      {portChannels.length > 0 && (
        <MobileSection title={`Port-channels · ${portChannels.length}`}>
          <MobileList>
            {portChannels.map((channel) => (
              <PortRow key={channel.id} port={channel} onOpen={() => setSelected(channel)} />
            ))}
          </MobileList>
        </MobileSection>
      )}

      <MobileSection title={`Ports · ${physicalPorts.length}`}>
        {physicalPorts.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
            Every physical port belongs to a port-channel above.
          </p>
        ) : (
          <MobileList>
            {physicalPorts.map((port) => (
              <PortRow key={port.id} port={port} onOpen={() => setSelected(port)} />
            ))}
          </MobileList>
        )}
      </MobileSection>

      <BottomSheet
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected?.name ?? "Port"}
        description={selected?.description ?? undefined}
      >
        {selected && (
          <div className="flex flex-col gap-3 pb-2">
            <div className="divide-y divide-border/60 rounded-xl border bg-card">
              <MobileKeyRow label="Mode">
                <ModeBadge mode={selected.mode} />
              </MobileKeyRow>
              <MobileKeyRow label="Status">{selected.isShutdown ? "Shutdown" : "Enabled"}</MobileKeyRow>
              {selected.mode === "trunk" && (
                <>
                  <MobileKeyRow label="Allowed VLANs" mono>
                    {allowedVlanText(selected.allowedVlans)}
                  </MobileKeyRow>
                  {selected.nativeVlanId != null && (
                    <MobileKeyRow label="Native VLAN" mono>
                      {selected.nativeVlanId}
                    </MobileKeyRow>
                  )}
                </>
              )}
              {selected.accessVlanId != null && (
                <MobileKeyRow label="Access VLAN" mono>
                  {selected.accessVlanId}
                </MobileKeyRow>
              )}
              {selected.voiceVlanId != null && (
                <MobileKeyRow label="Voice VLAN" mono>
                  {selected.voiceVlanId}
                </MobileKeyRow>
              )}
              {selected.ipAddress && (
                <MobileKeyRow label="IP address" mono>
                  {selected.ipAddress}
                </MobileKeyRow>
              )}
              {selected.channelGroup != null && (
                <MobileKeyRow label="Channel group" mono>
                  {selected.channelGroup}
                  {selected.channelMode ? ` (${selected.channelMode})` : ""}
                </MobileKeyRow>
              )}
              <MobileKeyRow label="Connected device">
                {selected.connectedDevice ? (
                  <Link
                    href={`/inventory/hosts/${selected.connectedDevice.id}`}
                    className="text-primary underline-offset-4 active:underline"
                  >
                    {selected.connectedDevice.name}
                  </Link>
                ) : (
                  "—"
                )}
              </MobileKeyRow>
            </div>
            {selected.isPortChannel && (
              <div className="rounded-xl border bg-card p-3">
                <p className="mb-1.5 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
                  Member ports
                </p>
                {members.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No member ports found in the config.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {members.map((member) => (
                      <li key={member.id} className={cn("flex items-center gap-2 text-xs", member.isShutdown && "opacity-60")}>
                        <span className="font-mono font-medium">{member.shortName}</span>
                        {member.description && (
                          <span className="truncate text-muted-foreground">{member.description}</span>
                        )}
                        <span className="ml-auto flex shrink-0 items-center gap-1">
                          {member.isShutdown && (
                            <Badge variant="destructive" className="text-[10px]">
                              shut
                            </Badge>
                          )}
                          {member.channelMode && (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              {member.channelMode}
                            </Badge>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </BottomSheet>
    </>
  );
}
