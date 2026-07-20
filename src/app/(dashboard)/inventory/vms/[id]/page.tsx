import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { getVm } from "@/lib/services/inventory";
import { formatBytes, formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { PowerBadge, SourceBadge, StatusBadge } from "@/components/shared/badges";
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
  GuestsTable,
  InterfacesTable,
  ServicesTable,
} from "@/components/inventory/sub-tables";
import { TagPicker } from "@/components/inventory/tag-picker";
import { DescriptionEditor } from "@/components/docs/description-editor";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const vm = await getVm(id).catch(() => null);
  return { title: vm?.name ?? "Virtual machine" };
}

export default async function VmDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  const vm = await getVm(id).catch(() => null);
  if (!vm) notFound();

  const initial = {
    name: vm.name,
    hostId: vm.host?.id ?? "",
    powerState: vm.powerState,
    cpuCores: vm.cpuCores?.toString() ?? "",
    memoryGib: bytesToGibString(vm.memoryBytes),
    diskGib: bytesToGibString(vm.diskBytes),
    osName: vm.osName ?? "",
    description: vm.description ?? "",
  };

  return (
    <div>
      <PageHeader
        title={vm.name}
        actions={
          <>
            <EntityFormDialog
              entity="vms"
              mode="edit"
              entityId={vm.id}
              initial={initial}
              source={vm.source}
              trigger={
                <Button variant="outline">
                  <Pencil />
                  Edit
                </Button>
              }
            />
            <DeleteEntityButton
              apiPath={`/api/inventory/vms/${vm.id}`}
              entityLabel={`VM “${vm.name}”`}
              redirectTo="/inventory/vms"
            />
          </>
        }
      >
        <div className="-mt-2 flex flex-wrap items-center gap-2">
          <PowerBadge state={vm.powerState} />
          <SourceBadge source={vm.source} />
          <StatusBadge status={vm.status} />
          {vm.host && (
            <span className="text-xs text-muted-foreground">
              on{" "}
              <Link
                href={`/inventory/hosts/${vm.host.id}`}
                className="font-medium text-foreground hover:text-primary hover:underline underline-offset-4"
              >
                {vm.host.name}
              </Link>
            </span>
          )}
          {vm.lastSeenAt && (
            <span className="text-xs text-muted-foreground">
              Last seen {formatRelative(vm.lastSeenAt)}
            </span>
          )}
        </div>
      </PageHeader>

      <DetailGrid
        main={
          <>
            <SectionCard title="Containers" count={vm.containers.length} flush>
              <GuestsTable rows={vm.containers} hrefBase="/inventory/containers" />
            </SectionCard>
            <SectionCard title="Network interfaces" count={vm.interfaces.length} flush>
              <InterfacesTable rows={vm.interfaces} />
            </SectionCard>
            <SectionCard title="Services" count={vm.services.length} flush>
              <ServicesTable rows={vm.services} />
            </SectionCard>
            <SectionCard title="Description">
              <DescriptionEditor
                apiPath={`/api/inventory/vms/${vm.id}`}
                initialValue={vm.description}
                entity={{ type: "vm", id: vm.id }}
              />
            </SectionCard>
          </>
        }
        side={
          <>
            <SectionCard title="Details">
              <SpecList>
                <SpecItem label="Host">
                  {vm.host ? (
                    <EntityLink href={`/inventory/hosts/${vm.host.id}`}>{vm.host.name}</EntityLink>
                  ) : (
                    <Muted />
                  )}
                </SpecItem>
                <SpecItem label="VMID">
                  <Muted>{vm.vmid}</Muted>
                </SpecItem>
                <SpecItem label="vCPU cores">
                  <Muted>{vm.cpuCores}</Muted>
                </SpecItem>
                <SpecItem label="Memory">{formatBytes(vm.memoryBytes)}</SpecItem>
                <SpecItem label="Disk">{formatBytes(vm.diskBytes)}</SpecItem>
                <SpecItem label="Operating system">
                  <Muted>{vm.osName}</Muted>
                </SpecItem>
                {vm.integration && <SpecItem label="Integration">{vm.integration.name}</SpecItem>}
                <SpecItem label="Created">{formatRelative(vm.createdAt)}</SpecItem>
                <SpecItem label="Updated">{formatRelative(vm.updatedAt)}</SpecItem>
              </SpecList>
            </SectionCard>
            <SectionCard title="Tags">
              <TagPicker
                entityType="vm"
                entityId={vm.id}
                assigned={vm.tags.map((t) => ({
                  id: t.tag.id,
                  name: t.tag.name,
                  color: t.tag.color,
                }))}
              />
            </SectionCard>
            <MetadataCard metadata={vm.metadata} />
            <AuditTrail entityType="vm" entityId={vm.id} />
          </>
        }
      />
    </div>
  );
}
