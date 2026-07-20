import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { getDevice } from "@/lib/services/inventory";
import { formatBytes, formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SourceBadge, StatusBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { bytesToGibString } from "@/components/inventory/entity-configs";
import { MetadataCard } from "@/components/inventory/metadata-card";
import {
  GuestsTable,
  InterfacesTable,
  PoolsTable,
  ServicesTable,
} from "@/components/inventory/sub-tables";
import { TagPicker } from "@/components/inventory/tag-picker";
import { DescriptionEditor } from "@/components/docs/description-editor";
import { FocusedFootprint } from "@/components/topology/focused-footprint";
import { AssociatedLogsPanel } from "@/components/inventory/associated-logs-panel";
import { listLogSources } from "@/lib/services/logs";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const host = await getDevice(id).catch(() => null);
  return { title: host?.name ?? "Host" };
}

export default async function HostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageUser();
  const { id } = await params;
  const [host, logSources] = await Promise.all([
    getDevice(id).catch(() => null),
    listLogSources(),
  ]);
  if (!host) notFound();

  const initial = {
    name: host.name,
    kind: host.kind,
    manufacturer: host.manufacturer ?? "",
    model: host.model ?? "",
    location: host.location ?? "",
    cpuModel: host.cpuModel ?? "",
    cpuCores: host.cpuCores?.toString() ?? "",
    memoryGib: bytesToGibString(host.memoryBytes),
    osName: host.osName ?? "",
    osVersion: host.osVersion ?? "",
    description: host.description ?? "",
  };

  return (
    <div>
      <PageHeader
        title={host.name}
        actions={
          <>
            <EntityFormDialog
              entity="hosts"
              mode="edit"
              entityId={host.id}
              initial={initial}
              source={host.source}
              trigger={
                <Button variant="outline">
                  <Pencil />
                  Edit
                </Button>
              }
            />
            <DeleteEntityButton
              apiPath={`/api/inventory/hosts/${host.id}`}
              entityLabel={`host “${host.name}”`}
              redirectTo="/inventory/hosts"
            />
          </>
        }
      >
        <div className="-mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="capitalize">
            {host.kind}
          </Badge>
          <SourceBadge source={host.source} />
          <StatusBadge status={host.status} />
          {host.lastSeenAt && (
            <span className="text-xs text-muted-foreground">
              Last seen {formatRelative(host.lastSeenAt)}
            </span>
          )}
        </div>
      </PageHeader>

      <FocusedFootprint targetId={host.id} />

      <DetailGrid
        main={
          <>
            <SectionCard title="Virtual machines" count={host.vms.length} flush>
              <GuestsTable rows={host.vms} hrefBase="/inventory/vms" />
            </SectionCard>
            <SectionCard
              title="Containers"
              count={host.containers.length}
              flush
            >
              <GuestsTable
                rows={host.containers}
                hrefBase="/inventory/containers"
              />
            </SectionCard>
            <SectionCard
              title="Network interfaces"
              count={host.interfaces.length}
              flush
            >
              <InterfacesTable rows={host.interfaces} />
            </SectionCard>
            <SectionCard title="Services" count={host.services.length} flush>
              <ServicesTable rows={host.services} />
            </SectionCard>
            <SectionCard
              title="Storage pools"
              count={host.storagePools.length}
              flush
            >
              <PoolsTable rows={host.storagePools} />
            </SectionCard>
            <SectionCard title="Description">
              <DescriptionEditor
                apiPath={`/api/inventory/hosts/${host.id}`}
                initialValue={host.description}
                entity={{ type: "device", id: host.id }}
              />
            </SectionCard>
            {logSources.length > 0 && (
              <AssociatedLogsPanel
                entity="hosts"
                entityId={host.id}
                subjectName={host.name}
                sources={logSources}
              />
            )}
          </>
        }
        side={
          <>
            <SectionCard title="Details">
              <SpecList>
                <SpecItem label="Manufacturer">
                  <Muted>{host.manufacturer}</Muted>
                </SpecItem>
                <SpecItem label="Model">
                  <Muted>{host.model}</Muted>
                </SpecItem>
                <SpecItem label="Location">
                  <Muted>{host.location}</Muted>
                </SpecItem>
                <SpecItem label="CPU">
                  <Muted>{host.cpuModel}</Muted>
                </SpecItem>
                <SpecItem label="CPU cores">
                  <Muted>{host.cpuCores}</Muted>
                </SpecItem>
                <SpecItem label="Memory">
                  {formatBytes(host.memoryBytes)}
                </SpecItem>
                <SpecItem label="Operating system">
                  <Muted>
                    {host.osName
                      ? `${host.osName} ${host.osVersion ?? ""}`.trim()
                      : null}
                  </Muted>
                </SpecItem>
                {host.integration && (
                  <SpecItem label="Integration">
                    {host.integration.name}
                  </SpecItem>
                )}
                <SpecItem label="Created">
                  {formatRelative(host.createdAt)}
                </SpecItem>
                <SpecItem label="Updated">
                  {formatRelative(host.updatedAt)}
                </SpecItem>
              </SpecList>
            </SectionCard>
            <SectionCard title="Tags">
              <TagPicker
                entityType="device"
                entityId={host.id}
                assigned={host.tags.map((t) => ({
                  id: t.tag.id,
                  name: t.tag.name,
                  color: t.tag.color,
                }))}
              />
            </SectionCard>
            <MetadataCard metadata={host.metadata} />
            <AuditTrail entityType="device" entityId={host.id} />
          </>
        }
      />
    </div>
  );
}
