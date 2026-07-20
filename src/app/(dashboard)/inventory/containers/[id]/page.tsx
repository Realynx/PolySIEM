import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { getContainer } from "@/lib/services/inventory";
import { formatBytes, formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import {
  PowerBadge,
  SourceBadge,
  StatusBadge,
} from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AuditTrail } from "@/components/inventory/audit-trail";
import { DeleteEntityButton } from "@/components/inventory/delete-entity-button";
import {
  DetailGrid,
  EntityLink,
  Muted,
  SectionCard,
  SpecItem,
  SpecList,
} from "@/components/inventory/detail-bits";
import { EntityFormDialog } from "@/components/inventory/entity-form-dialog";
import { bytesToGibString } from "@/components/inventory/entity-configs";
import { MetadataCard } from "@/components/inventory/metadata-card";
import {
  InterfacesTable,
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
  const ct = await getContainer(id).catch(() => null);
  return { title: ct?.name ?? "Container" };
}

export default async function ContainerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageUser();
  const { id } = await params;
  const [ct, logSources] = await Promise.all([
    getContainer(id).catch(() => null),
    listLogSources(),
  ]);
  if (!ct) notFound();

  const initial = {
    name: ct.name,
    runtime: ct.runtime,
    hostId: ct.host?.id ?? "",
    vmId: ct.vm?.id ?? "",
    powerState: ct.powerState,
    cpuCores: ct.cpuCores?.toString() ?? "",
    memoryGib: bytesToGibString(ct.memoryBytes),
    diskGib: bytesToGibString(ct.diskBytes),
    osName: ct.osName ?? "",
    description: ct.description ?? "",
  };

  return (
    <div>
      <PageHeader
        title={ct.name}
        actions={
          <>
            <EntityFormDialog
              entity="containers"
              mode="edit"
              entityId={ct.id}
              initial={initial}
              source={ct.source}
              trigger={
                <Button variant="outline">
                  <Pencil />
                  Edit
                </Button>
              }
            />
            <DeleteEntityButton
              apiPath={`/api/inventory/containers/${ct.id}`}
              entityLabel={`container “${ct.name}”`}
              redirectTo="/inventory/containers"
            />
          </>
        }
      >
        <div className="-mt-2 flex flex-wrap items-center gap-2">
          <PowerBadge state={ct.powerState} />
          <Badge variant="secondary" className="uppercase">
            {ct.runtime}
          </Badge>
          <SourceBadge source={ct.source} />
          <StatusBadge status={ct.status} />
          {(ct.vm || ct.host) && (
            <span className="text-xs text-muted-foreground">
              on{" "}
              <Link
                href={
                  ct.vm
                    ? `/inventory/vms/${ct.vm.id}`
                    : `/inventory/hosts/${ct.host!.id}`
                }
                className="font-medium text-foreground hover:text-primary hover:underline underline-offset-4"
              >
                {ct.vm?.name ?? ct.host?.name}
              </Link>
            </span>
          )}
          {ct.lastSeenAt && (
            <span className="text-xs text-muted-foreground">
              Last seen {formatRelative(ct.lastSeenAt)}
            </span>
          )}
        </div>
      </PageHeader>

      <FocusedFootprint targetId={ct.id} />

      <DetailGrid
        main={
          <>
            <SectionCard
              title="Network interfaces"
              count={ct.interfaces.length}
              flush
            >
              <InterfacesTable rows={ct.interfaces} />
            </SectionCard>
            <SectionCard title="Services" count={ct.services.length} flush>
              <ServicesTable rows={ct.services} />
            </SectionCard>
            <SectionCard title="Description">
              <DescriptionEditor
                apiPath={`/api/inventory/containers/${ct.id}`}
                initialValue={ct.description}
                entity={{ type: "container", id: ct.id }}
              />
            </SectionCard>
            {logSources.length > 0 && (
              <AssociatedLogsPanel
                entity="containers"
                entityId={ct.id}
                subjectName={ct.name}
                sources={logSources}
              />
            )}
          </>
        }
        side={
          <>
            <SectionCard title="Details">
              <SpecList>
                <SpecItem label="Host">
                  {ct.host ? (
                    <EntityLink href={`/inventory/hosts/${ct.host.id}`}>
                      {ct.host.name}
                    </EntityLink>
                  ) : (
                    <Muted />
                  )}
                </SpecItem>
                <SpecItem label="VM">
                  {ct.vm ? (
                    <EntityLink href={`/inventory/vms/${ct.vm.id}`}>
                      {ct.vm.name}
                    </EntityLink>
                  ) : (
                    <Muted />
                  )}
                </SpecItem>
                <SpecItem label="VMID">
                  <Muted>{ct.vmid}</Muted>
                </SpecItem>
                <SpecItem label="CPU cores">
                  <Muted>{ct.cpuCores}</Muted>
                </SpecItem>
                <SpecItem label="Memory">
                  {formatBytes(ct.memoryBytes)}
                </SpecItem>
                <SpecItem label="Disk">{formatBytes(ct.diskBytes)}</SpecItem>
                <SpecItem label="OS / image">
                  <Muted>{ct.osName}</Muted>
                </SpecItem>
                {ct.integration && (
                  <SpecItem label="Integration">{ct.integration.name}</SpecItem>
                )}
                <SpecItem label="Created">
                  {formatRelative(ct.createdAt)}
                </SpecItem>
                <SpecItem label="Updated">
                  {formatRelative(ct.updatedAt)}
                </SpecItem>
              </SpecList>
            </SectionCard>
            <SectionCard title="Tags">
              <TagPicker
                entityType="container"
                entityId={ct.id}
                assigned={ct.tags.map((t) => ({
                  id: t.tag.id,
                  name: t.tag.name,
                  color: t.tag.color,
                }))}
              />
            </SectionCard>
            <MetadataCard metadata={ct.metadata} />
            <AuditTrail entityType="container" entityId={ct.id} />
          </>
        }
      />
    </div>
  );
}
