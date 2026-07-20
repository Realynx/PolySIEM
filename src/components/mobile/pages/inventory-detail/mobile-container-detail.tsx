import Link from "next/link";
import { Cpu, HardDrive, MemoryStick, Pencil } from "lucide-react";
import type { getContainer } from "@/lib/services/inventory";
import type { listLogSources } from "@/lib/services/logs";
import { formatBytes, formatRelative } from "@/lib/format";
import { PowerBadge, SourceBadge, StatusBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AuditTrail } from "@/components/inventory/audit-trail";
import { DeleteEntityButton } from "@/components/inventory/delete-entity-button";
import { EntityLink, Muted } from "@/components/inventory/detail-bits";
import { EntityFormDialog } from "@/components/inventory/entity-form-dialog";
import type { FormValues } from "@/components/inventory/entity-configs";
import { TagPicker } from "@/components/inventory/tag-picker";
import { DescriptionEditor } from "@/components/docs/description-editor";
import { AssociatedLogsPanel } from "@/components/inventory/associated-logs-panel";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileKeyRow, MobileList } from "@/components/mobile/ui/mobile-list";
import { MobileStat, MobileStatStrip } from "@/components/mobile/ui/mobile-stats";
import { MobileCard, MobileInterfaceList, MobileServiceList } from "./detail-bits";
import { MobileMetadataSheet } from "./metadata-sheet";

type ContainerDetail = Awaited<ReturnType<typeof getContainer>>;
type LogSources = Awaited<ReturnType<typeof listLogSources>>;

/** Phone presentation of /inventory/containers/[id]; same payload as desktop. */
export function MobileContainerDetail({
  ct,
  logSources,
  initial,
}: {
  ct: ContainerDetail;
  logSources: LogSources;
  initial: FormValues;
}) {
  return (
    <>
      <MobilePageHeader
        title={ct.name}
        backHref="/inventory/containers"
        actions={
          <>
            <EntityFormDialog
              entity="containers"
              mode="edit"
              entityId={ct.id}
              initial={initial}
              source={ct.source}
              trigger={
                <Button variant="ghost" size="icon" aria-label="Edit container">
                  <Pencil />
                </Button>
              }
            />
            <DeleteEntityButton
              apiPath={`/api/inventory/containers/${ct.id}`}
              entityLabel={`container “${ct.name}”`}
              redirectTo="/inventory/containers"
              iconOnly
            />
          </>
        }
      />
      <MobilePage>
        <div className="flex flex-wrap items-center gap-1.5">
          <PowerBadge state={ct.powerState} className="text-xs" />
          <Badge variant="secondary" className="uppercase">
            {ct.runtime}
          </Badge>
          <SourceBadge source={ct.source} />
          <StatusBadge status={ct.status} />
          {(ct.vm || ct.host) && (
            <span className="text-[11px] text-muted-foreground">
              on{" "}
              <Link
                href={ct.vm ? `/inventory/vms/${ct.vm.id}` : `/inventory/hosts/${ct.host!.id}`}
                className="font-medium text-foreground underline-offset-4 active:underline"
              >
                {ct.vm?.name ?? ct.host?.name}
              </Link>
            </span>
          )}
          {ct.lastSeenAt && (
            <span className="text-[11px] text-muted-foreground">
              Last seen {formatRelative(ct.lastSeenAt)}
            </span>
          )}
        </div>

        <MobileStatStrip>
          <MobileStat label="CPU" value={ct.cpuCores ?? "—"} icon={<Cpu />} />
          <MobileStat label="Memory" value={formatBytes(ct.memoryBytes)} icon={<MemoryStick />} />
          <MobileStat label="Disk" value={formatBytes(ct.diskBytes)} icon={<HardDrive />} />
          <MobileStat label="Services" value={ct.services.length} />
        </MobileStatStrip>

        <MobileSection title="Details">
          <MobileList>
            <MobileKeyRow label="Host">
              {ct.host ? (
                <EntityLink href={`/inventory/hosts/${ct.host.id}`}>{ct.host.name}</EntityLink>
              ) : (
                <Muted />
              )}
            </MobileKeyRow>
            <MobileKeyRow label="VM">
              {ct.vm ? (
                <EntityLink href={`/inventory/vms/${ct.vm.id}`}>{ct.vm.name}</EntityLink>
              ) : (
                <Muted />
              )}
            </MobileKeyRow>
            <MobileKeyRow label="VMID" mono>
              <Muted>{ct.vmid}</Muted>
            </MobileKeyRow>
            <MobileKeyRow label="CPU cores">
              <Muted>{ct.cpuCores}</Muted>
            </MobileKeyRow>
            <MobileKeyRow label="Memory">{formatBytes(ct.memoryBytes)}</MobileKeyRow>
            <MobileKeyRow label="Disk">{formatBytes(ct.diskBytes)}</MobileKeyRow>
            <MobileKeyRow label="OS / image">
              <Muted>{ct.osName}</Muted>
            </MobileKeyRow>
            {ct.integration && (
              <MobileKeyRow label="Integration">{ct.integration.name}</MobileKeyRow>
            )}
            <MobileKeyRow label="Created">{formatRelative(ct.createdAt)}</MobileKeyRow>
            <MobileKeyRow label="Updated">{formatRelative(ct.updatedAt)}</MobileKeyRow>
          </MobileList>
        </MobileSection>

        <MobileSection title={`Network interfaces (${ct.interfaces.length})`}>
          <MobileInterfaceList rows={ct.interfaces} />
        </MobileSection>

        <MobileSection title={`Services (${ct.services.length})`}>
          <MobileServiceList rows={ct.services} />
        </MobileSection>

        <MobileSection title="Description">
          <MobileCard>
            <DescriptionEditor
              apiPath={`/api/inventory/containers/${ct.id}`}
              initialValue={ct.description}
              entity={{ type: "container", id: ct.id }}
            />
          </MobileCard>
        </MobileSection>

        <MobileSection title="Tags">
          <MobileCard>
            <TagPicker
              entityType="container"
              entityId={ct.id}
              assigned={ct.tags.map((t) => ({
                id: t.tag.id,
                name: t.tag.name,
                color: t.tag.color,
              }))}
            />
          </MobileCard>
        </MobileSection>

        {logSources.length > 0 && (
          <AssociatedLogsPanel
            entity="containers"
            entityId={ct.id}
            subjectName={ct.name}
            sources={logSources}
          />
        )}

        <MobileMetadataSheet metadata={ct.metadata} />
        <AuditTrail entityType="container" entityId={ct.id} />
      </MobilePage>
    </>
  );
}
