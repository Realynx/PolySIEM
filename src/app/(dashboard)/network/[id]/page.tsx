import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { getNetwork } from "@/lib/services/inventory";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { isMobileView } from "@/lib/device";
import { formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SourceBadge, StatusBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AuditTrail } from "@/components/inventory/audit-trail";
import { DeleteEntityButton } from "@/components/inventory/delete-entity-button";
import {
  DetailGrid,
  Muted,
  SectionCard,
  SpecItem,
  SpecList,
} from "@/components/inventory/detail-bits";
import { EntityFormDialog } from "@/components/inventory/entity-form-dialog";
import { MetadataCard } from "@/components/inventory/metadata-card";
import { InterfacesTable, SubTableEmpty } from "@/components/inventory/sub-tables";
import { TagPicker } from "@/components/inventory/tag-picker";
import { DescriptionEditor } from "@/components/docs/description-editor";
import { MobileNetworkDetail } from "@/components/mobile/pages/network/mobile-network-detail";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const net = await anonymizeForDisplay(await getNetwork(id).catch(() => null));
  return { title: net?.name ?? "Network" };
}

export default async function NetworkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  const found = await getNetwork(id).catch(() => null);
  if (!found) notFound();
  const net = await anonymizeForDisplay(found);

  // ARP-detected devices not already listed as a documented IP or DHCP lease.
  const knownIps = new Set<string>([
    ...net.ipAddresses.map((ip) => ip.address),
    ...net.dhcpLeases.map((lease) => lease.ipAddress),
  ]);
  const detected = net.neighbors.filter((n) => !n.permanent && !knownIps.has(n.ipAddress));

  // Edit-form seed stays real: anonymized values must never round-trip into a mutation.
  const initial = {
    name: found.name,
    vlanId: found.vlanId?.toString() ?? "",
    cidr: found.cidr ?? "",
    gateway: found.gateway ?? "",
    domain: found.domain ?? "",
    purpose: found.purpose ?? "",
    description: found.description ?? "",
  };

  if (await isMobileView()) {
    return <MobileNetworkDetail net={net} detected={detected} initial={initial} />;
  }

  const desktopView = () => (
    <div>
      <PageHeader
        title={net.name}
        actions={
          <>
            <EntityFormDialog
              entity="networks"
              mode="edit"
              entityId={net.id}
              initial={initial}
              source={net.source}
              trigger={
                <Button variant="outline">
                  <Pencil />
                  Edit
                </Button>
              }
            />
            <DeleteEntityButton
              apiPath={`/api/inventory/networks/${net.id}`}
              entityLabel={`network “${net.name}”`}
              redirectTo="/network"
            />
          </>
        }
      >
        <div className="-mt-2 flex flex-wrap items-center gap-2">
          {net.vlanId != null && <Badge variant="secondary">VLAN {net.vlanId}</Badge>}
          {net.cidr && (
            <Badge variant="outline" className="font-mono text-xs">
              {net.cidr}
            </Badge>
          )}
          <SourceBadge source={net.source} />
          <StatusBadge status={net.status} />
        </div>
      </PageHeader>

      <DetailGrid
        main={
          <>
            <SectionCard title="Member interfaces" count={net.interfaces.length} flush>
              <InterfacesTable rows={net.interfaces} showOwner />
            </SectionCard>
            <SectionCard title="IP addresses" count={net.ipAddresses.length} flush>
              {net.ipAddresses.length === 0 ? (
                <SubTableEmpty label="No addresses documented on this network." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Address</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {net.ipAddresses.map((ip) => (
                      <TableRow key={ip.id}>
                        <TableCell className="font-mono text-xs font-medium">{ip.address}</TableCell>
                        <TableCell className="max-w-64 truncate text-muted-foreground">
                          {ip.description ?? "—"}
                        </TableCell>
                        <TableCell>
                          <SourceBadge source={ip.source} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </SectionCard>
            <SectionCard title="DHCP leases" count={net.dhcpLeases.length} flush>
              {net.dhcpLeases.length === 0 ? (
                <SubTableEmpty label="No DHCP leases on this network." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP address</TableHead>
                      <TableHead>Hostname</TableHead>
                      <TableHead className="hidden sm:table-cell">MAC address</TableHead>
                      <TableHead>Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {net.dhcpLeases.map((lease) => (
                      <TableRow key={lease.id}>
                        <TableCell className="font-mono text-xs font-medium">{lease.ipAddress}</TableCell>
                        <TableCell>
                          {lease.hostname ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                          {lease.macAddress ?? "—"}
                        </TableCell>
                        <TableCell>
                          {lease.isStatic ? (
                            <Badge variant="outline" className="border-info/40 bg-info/10 text-info">
                              Static
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              Dynamic
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </SectionCard>
            <SectionCard title="Detected devices" count={detected.length} flush>
              {detected.length === 0 ? (
                <SubTableEmpty label="No additional devices detected in the ARP table." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>IP address</TableHead>
                      <TableHead>Hostname</TableHead>
                      <TableHead className="hidden sm:table-cell">MAC address</TableHead>
                      <TableHead className="hidden md:table-cell">Vendor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detected.map((neighbor) => (
                      <TableRow key={neighbor.id}>
                        <TableCell className="font-mono text-xs font-medium">{neighbor.ipAddress}</TableCell>
                        <TableCell>
                          {neighbor.hostname ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                          {neighbor.macAddress ?? "—"}
                        </TableCell>
                        <TableCell className="hidden max-w-44 truncate text-muted-foreground md:table-cell">
                          {neighbor.manufacturer ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </SectionCard>
            <SectionCard title="Description">
              <DescriptionEditor
                apiPath={`/api/inventory/networks/${net.id}`}
                initialValue={found.description}
                entity={{ type: "network", id: net.id }}
              />
            </SectionCard>
          </>
        }
        side={
          <>
            <SectionCard title="Details">
              <SpecList>
                <SpecItem label="VLAN ID">
                  <Muted>{net.vlanId}</Muted>
                </SpecItem>
                <SpecItem label="CIDR">
                  <Muted>{net.cidr && <span className="font-mono text-xs">{net.cidr}</span>}</Muted>
                </SpecItem>
                <SpecItem label="Gateway">
                  <Muted>{net.gateway && <span className="font-mono text-xs">{net.gateway}</span>}</Muted>
                </SpecItem>
                <SpecItem label="Domain">
                  <Muted>{net.domain}</Muted>
                </SpecItem>
                <SpecItem label="Purpose">
                  <Muted>{net.purpose}</Muted>
                </SpecItem>
                {net.integration && <SpecItem label="Integration">{net.integration.name}</SpecItem>}
                <SpecItem label="Created">{formatRelative(net.createdAt)}</SpecItem>
                <SpecItem label="Updated">{formatRelative(net.updatedAt)}</SpecItem>
              </SpecList>
            </SectionCard>
            <SectionCard title="Tags">
              <TagPicker
                entityType="network"
                entityId={net.id}
                assigned={net.tags.map((t) => ({
                  id: t.tag.id,
                  name: t.tag.name,
                  color: t.tag.color,
                }))}
              />
            </SectionCard>
            <MetadataCard metadata={net.metadata} />
            <AuditTrail entityType="network" entityId={net.id} />
          </>
        }
      />
    </div>
  );
  return desktopView();
}
