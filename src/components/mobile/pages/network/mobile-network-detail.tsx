import { Pencil } from "lucide-react";
import type { getNetwork } from "@/lib/services/inventory";
import { formatRelative } from "@/lib/format";
import { SourceBadge, StatusBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { EntityFormDialog } from "@/components/inventory/entity-form-dialog";
import type { FormValues } from "@/components/inventory/entity-configs";
import { TagBadge } from "@/components/inventory/tag-badge";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileKeyRow, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileStat, MobileStatStrip } from "@/components/mobile/ui/mobile-stats";

type NetworkDetail = Awaited<ReturnType<typeof getNetwork>>;

/** Muted inline placeholder for detail sections with nothing to list. */
function SectionEmpty({ label }: { label: string }) {
  return <p className="px-0.5 py-1 text-xs text-muted-foreground">{label}</p>;
}

/** Phone presentation of /network/[id] — hero, key facts, then grouped lists. */
export function MobileNetworkDetail({
  net,
  detected,
  initial,
}: {
  net: NetworkDetail;
  /** ARP neighbors not already documented as an IP or lease (computed by the page). */
  detected: NetworkDetail["neighbors"];
  /** Real (non-anonymized) edit-form seed from the page. */
  initial: FormValues;
}) {
  return (
    <>
      <MobilePageHeader
        title={net.name}
        backHref="/network"
        actions={
          <EntityFormDialog
            entity="networks"
            mode="edit"
            entityId={net.id}
            initial={initial}
            source={net.source}
            trigger={
              <button
                type="button"
                aria-label="Edit network"
                className="flex size-10 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
              >
                <Pencil className="size-4.5" />
              </button>
            }
          />
        }
      />
      <MobilePage>
        <div className="flex flex-wrap items-center gap-1.5">
          {net.vlanId != null && <Badge variant="secondary">VLAN {net.vlanId}</Badge>}
          {net.cidr && (
            <Badge variant="outline" className="font-mono text-xs">
              {net.cidr}
            </Badge>
          )}
          <SourceBadge source={net.source} />
          <StatusBadge status={net.status} />
        </div>

        <MobileStatStrip>
          <MobileStat label="IPs" value={net.ipAddresses.length} />
          <MobileStat label="Leases" value={net.dhcpLeases.length} />
          <MobileStat label="Detected" value={detected.length} />
          <MobileStat label="Interfaces" value={net.interfaces.length} />
        </MobileStatStrip>

        <MobileSection title="Details">
          <MobileList>
            <MobileKeyRow label="CIDR" mono>
              {net.cidr ?? <span className="font-sans text-muted-foreground">—</span>}
            </MobileKeyRow>
            <MobileKeyRow label="Gateway" mono>
              {net.gateway ?? <span className="font-sans text-muted-foreground">—</span>}
            </MobileKeyRow>
            <MobileKeyRow label="Domain">
              {net.domain ?? <span className="text-muted-foreground">—</span>}
            </MobileKeyRow>
            <MobileKeyRow label="Purpose">
              {net.purpose ?? <span className="text-muted-foreground">—</span>}
            </MobileKeyRow>
            {net.integration && <MobileKeyRow label="Integration">{net.integration.name}</MobileKeyRow>}
            <MobileKeyRow label="Created">{formatRelative(net.createdAt)}</MobileKeyRow>
            <MobileKeyRow label="Updated">{formatRelative(net.updatedAt)}</MobileKeyRow>
          </MobileList>
        </MobileSection>

        <MobileSection title={`IP addresses · ${net.ipAddresses.length}`}>
          {net.ipAddresses.length === 0 ? (
            <SectionEmpty label="No addresses documented on this network." />
          ) : (
            <MobileList>
              {net.ipAddresses.map((ip) => (
                <MobileListRow
                  key={ip.id}
                  title={<span className="font-mono text-[13px] break-all">{ip.address}</span>}
                  subtitle={ip.description ?? undefined}
                  trailing={<SourceBadge source={ip.source} />}
                />
              ))}
            </MobileList>
          )}
        </MobileSection>

        <MobileSection title={`DHCP leases · ${net.dhcpLeases.length}`}>
          {net.dhcpLeases.length === 0 ? (
            <SectionEmpty label="No DHCP leases on this network." />
          ) : (
            <MobileList>
              {net.dhcpLeases.map((lease) => (
                <MobileListRow
                  key={lease.id}
                  title={<span className="font-mono text-[13px] break-all">{lease.ipAddress}</span>}
                  subtitle={
                    <>
                      {lease.hostname ?? "Unknown host"}
                      {lease.macAddress && (
                        <span className="font-mono"> · {lease.macAddress}</span>
                      )}
                    </>
                  }
                  trailing={
                    lease.isStatic ? (
                      <Badge variant="outline" className="border-info/40 bg-info/10 text-info">
                        Static
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Dynamic
                      </Badge>
                    )
                  }
                />
              ))}
            </MobileList>
          )}
        </MobileSection>

        <MobileSection title={`Detected devices · ${detected.length}`}>
          {detected.length === 0 ? (
            <SectionEmpty label="No additional devices detected in the ARP table." />
          ) : (
            <MobileList>
              {detected.map((neighbor) => (
                <MobileListRow
                  key={neighbor.id}
                  title={<span className="font-mono text-[13px] break-all">{neighbor.ipAddress}</span>}
                  subtitle={
                    <>
                      {neighbor.hostname ?? neighbor.manufacturer ?? "Unknown device"}
                      {neighbor.macAddress && (
                        <span className="font-mono"> · {neighbor.macAddress}</span>
                      )}
                    </>
                  }
                />
              ))}
            </MobileList>
          )}
        </MobileSection>

        <MobileSection title={`Member interfaces · ${net.interfaces.length}`}>
          {net.interfaces.length === 0 ? (
            <SectionEmpty label="No network interfaces documented." />
          ) : (
            <MobileList>
              {net.interfaces.map((iface) => {
                const owner = iface.device
                  ? { href: `/inventory/hosts/${iface.device.id}`, name: iface.device.name }
                  : iface.vm
                    ? { href: `/inventory/vms/${iface.vm.id}`, name: iface.vm.name }
                    : iface.container
                      ? { href: `/inventory/containers/${iface.container.id}`, name: iface.container.name }
                      : null;
                return (
                  <MobileListRow
                    key={iface.id}
                    href={owner?.href}
                    title={
                      <>
                        <span className="truncate">{owner?.name ?? iface.name}</span>
                        {owner && (
                          <span className="truncate font-mono text-xs font-normal text-muted-foreground">
                            {iface.name}
                          </span>
                        )}
                      </>
                    }
                    subtitle={
                      <span className="font-mono">
                        {iface.ip?.address ?? iface.macAddress ?? "—"}
                      </span>
                    }
                  />
                );
              })}
            </MobileList>
          )}
        </MobileSection>

        {net.tags.length > 0 && (
          <MobileSection title="Tags">
            <div className="flex flex-wrap gap-1.5">
              {net.tags.map(({ tag }) => (
                <TagBadge key={tag.id} name={tag.name} color={tag.color} />
              ))}
            </div>
          </MobileSection>
        )}

        {net.description && (
          <MobileSection title="Description">
            <p className="text-[13px] leading-relaxed break-words whitespace-pre-wrap">
              {net.description}
            </p>
          </MobileSection>
        )}
      </MobilePage>
    </>
  );
}
