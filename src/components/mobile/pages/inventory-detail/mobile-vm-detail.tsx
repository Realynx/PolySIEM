import Link from "next/link";
import { Cpu, HardDrive, Layers, MemoryStick, Pencil } from "lucide-react";
import type { getVm } from "@/lib/services/inventory";
import { formatBytes, formatRelative } from "@/lib/format";
import { PowerBadge, SourceBadge, StatusBadge } from "@/components/shared/badges";
import { Button } from "@/components/ui/button";
import { AuditTrail } from "@/components/inventory/audit-trail";
import { DeleteEntityButton } from "@/components/inventory/delete-entity-button";
import { EntityLink, Muted } from "@/components/inventory/detail-bits";
import { EntityFormDialog } from "@/components/inventory/entity-form-dialog";
import type { FormValues } from "@/components/inventory/entity-configs";
import { TagPicker } from "@/components/inventory/tag-picker";
import { DescriptionEditor } from "@/components/docs/description-editor";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileKeyRow, MobileList } from "@/components/mobile/ui/mobile-list";
import { MobileStat, MobileStatStrip } from "@/components/mobile/ui/mobile-stats";
import { MobileCard, MobileGuestList, MobileInterfaceList, MobileServiceList } from "./detail-bits";
import { MobileMetadataSheet } from "./metadata-sheet";

type VmDetail = Awaited<ReturnType<typeof getVm>>;

/** Phone presentation of /inventory/vms/[id]; same payload as desktop. */
export function MobileVmDetail({ vm, initial }: { vm: VmDetail; initial: FormValues }) {
  return (
    <>
      <MobilePageHeader
        title={vm.name}
        backHref="/inventory/vms"
        actions={
          <>
            <EntityFormDialog
              entity="vms"
              mode="edit"
              entityId={vm.id}
              initial={initial}
              source={vm.source}
              trigger={
                <Button variant="ghost" size="icon" aria-label="Edit VM">
                  <Pencil />
                </Button>
              }
            />
            <DeleteEntityButton
              apiPath={`/api/inventory/vms/${vm.id}`}
              entityLabel={`VM “${vm.name}”`}
              redirectTo="/inventory/vms"
              iconOnly
            />
          </>
        }
      />
      <MobilePage>
        <div className="flex flex-wrap items-center gap-1.5">
          <PowerBadge state={vm.powerState} className="text-xs" />
          <SourceBadge source={vm.source} />
          <StatusBadge status={vm.status} />
          {vm.host && (
            <span className="text-[11px] text-muted-foreground">
              on{" "}
              <Link
                href={`/inventory/hosts/${vm.host.id}`}
                className="font-medium text-foreground underline-offset-4 active:underline"
              >
                {vm.host.name}
              </Link>
            </span>
          )}
          {vm.lastSeenAt && (
            <span className="text-[11px] text-muted-foreground">
              Last seen {formatRelative(vm.lastSeenAt)}
            </span>
          )}
        </div>

        <MobileStatStrip>
          <MobileStat label="vCPU" value={vm.cpuCores ?? "—"} icon={<Cpu />} />
          <MobileStat label="Memory" value={formatBytes(vm.memoryBytes)} icon={<MemoryStick />} />
          <MobileStat label="Disk" value={formatBytes(vm.diskBytes)} icon={<HardDrive />} />
          <MobileStat label="CTs" value={vm.containers.length} icon={<Layers />} />
          <MobileStat label="Services" value={vm.services.length} />
        </MobileStatStrip>

        <MobileSection title="Details">
          <MobileList>
            <MobileKeyRow label="Host">
              {vm.host ? (
                <EntityLink href={`/inventory/hosts/${vm.host.id}`}>{vm.host.name}</EntityLink>
              ) : (
                <Muted />
              )}
            </MobileKeyRow>
            <MobileKeyRow label="VMID" mono>
              <Muted>{vm.vmid}</Muted>
            </MobileKeyRow>
            <MobileKeyRow label="vCPU cores">
              <Muted>{vm.cpuCores}</Muted>
            </MobileKeyRow>
            <MobileKeyRow label="Memory">{formatBytes(vm.memoryBytes)}</MobileKeyRow>
            <MobileKeyRow label="Disk">{formatBytes(vm.diskBytes)}</MobileKeyRow>
            <MobileKeyRow label="Operating system">
              <Muted>{vm.osName}</Muted>
            </MobileKeyRow>
            {vm.integration && (
              <MobileKeyRow label="Integration">{vm.integration.name}</MobileKeyRow>
            )}
            <MobileKeyRow label="Created">{formatRelative(vm.createdAt)}</MobileKeyRow>
            <MobileKeyRow label="Updated">{formatRelative(vm.updatedAt)}</MobileKeyRow>
          </MobileList>
        </MobileSection>

        <MobileSection title={`Containers (${vm.containers.length})`}>
          <MobileGuestList rows={vm.containers} hrefBase="/inventory/containers" />
        </MobileSection>

        <MobileSection title={`Network interfaces (${vm.interfaces.length})`}>
          <MobileInterfaceList rows={vm.interfaces} />
        </MobileSection>

        <MobileSection title={`Services (${vm.services.length})`}>
          <MobileServiceList rows={vm.services} />
        </MobileSection>

        <MobileSection title="Description">
          <MobileCard>
            <DescriptionEditor
              apiPath={`/api/inventory/vms/${vm.id}`}
              initialValue={vm.description}
              entity={{ type: "vm", id: vm.id }}
            />
          </MobileCard>
        </MobileSection>

        <MobileSection title="Tags">
          <MobileCard>
            <TagPicker
              entityType="vm"
              entityId={vm.id}
              assigned={vm.tags.map((t) => ({
                id: t.tag.id,
                name: t.tag.name,
                color: t.tag.color,
              }))}
            />
          </MobileCard>
        </MobileSection>

        <MobileMetadataSheet metadata={vm.metadata} />
        <AuditTrail entityType="vm" entityId={vm.id} />
      </MobilePage>
    </>
  );
}
