import { Boxes, Cpu, Layers, MemoryStick, Pencil } from "lucide-react";
import type { getDevice } from "@/lib/services/inventory";
import type { listLogSources } from "@/lib/services/logs";
import { formatBytes, formatRelative } from "@/lib/format";
import { SourceBadge, StatusBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AuditTrail } from "@/components/inventory/audit-trail";
import { DeleteEntityButton } from "@/components/inventory/delete-entity-button";
import { Muted } from "@/components/inventory/detail-bits";
import { EntityFormDialog } from "@/components/inventory/entity-form-dialog";
import type { FormValues } from "@/components/inventory/entity-configs";
import { TagPicker } from "@/components/inventory/tag-picker";
import { DescriptionEditor } from "@/components/docs/description-editor";
import { AssociatedLogsPanel } from "@/components/inventory/associated-logs-panel";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileKeyRow, MobileList } from "@/components/mobile/ui/mobile-list";
import { MobileStat, MobileStatStrip } from "@/components/mobile/ui/mobile-stats";
import {
  MobileCard,
  MobileGuestList,
  MobileInterfaceList,
  MobilePoolList,
  MobileServiceList,
} from "./detail-bits";
import { MobileMetadataSheet } from "./metadata-sheet";

type HostDetail = Awaited<ReturnType<typeof getDevice>>;
type LogSources = Awaited<ReturnType<typeof listLogSources>>;

/** Phone presentation of /inventory/hosts/[id]; same payload as desktop. */
export function MobileHostDetail({
  host,
  logSources,
  initial,
}: {
  host: HostDetail;
  logSources: LogSources;
  initial: FormValues;
}) {
  return (
    <>
      <MobilePageHeader
        title={host.name}
        backHref="/inventory/hosts"
        actions={
          <>
            <EntityFormDialog
              entity="hosts"
              mode="edit"
              entityId={host.id}
              initial={initial}
              source={host.source}
              trigger={
                <Button variant="ghost" size="icon" aria-label="Edit host">
                  <Pencil />
                </Button>
              }
            />
            <DeleteEntityButton
              apiPath={`/api/inventory/hosts/${host.id}`}
              entityLabel={`host “${host.name}”`}
              redirectTo="/inventory/hosts"
              iconOnly
            />
          </>
        }
      />
      <MobilePage>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="capitalize">
            {host.kind}
          </Badge>
          <SourceBadge source={host.source} />
          <StatusBadge status={host.status} />
          {host.lastSeenAt && (
            <span className="text-[11px] text-muted-foreground">
              Last seen {formatRelative(host.lastSeenAt)}
            </span>
          )}
        </div>

        <MobileStatStrip>
          <MobileStat label="CPU" value={host.cpuCores ?? "—"} icon={<Cpu />} />
          <MobileStat label="Memory" value={formatBytes(host.memoryBytes)} icon={<MemoryStick />} />
          <MobileStat label="VMs" value={host.vms.length} icon={<Boxes />} />
          <MobileStat label="CTs" value={host.containers.length} icon={<Layers />} />
          <MobileStat label="Services" value={host.services.length} />
        </MobileStatStrip>

        <MobileSection title="Details">
          <MobileList>
            <MobileKeyRow label="Manufacturer">
              <Muted>{host.manufacturer}</Muted>
            </MobileKeyRow>
            <MobileKeyRow label="Model">
              <Muted>{host.model}</Muted>
            </MobileKeyRow>
            <MobileKeyRow label="Location">
              <Muted>{host.location}</Muted>
            </MobileKeyRow>
            <MobileKeyRow label="CPU">
              <Muted>{host.cpuModel}</Muted>
            </MobileKeyRow>
            <MobileKeyRow label="CPU cores">
              <Muted>{host.cpuCores}</Muted>
            </MobileKeyRow>
            <MobileKeyRow label="Memory">{formatBytes(host.memoryBytes)}</MobileKeyRow>
            <MobileKeyRow label="Operating system">
              <Muted>
                {host.osName ? `${host.osName} ${host.osVersion ?? ""}`.trim() : null}
              </Muted>
            </MobileKeyRow>
            {host.integration && (
              <MobileKeyRow label="Integration">{host.integration.name}</MobileKeyRow>
            )}
            <MobileKeyRow label="Created">{formatRelative(host.createdAt)}</MobileKeyRow>
            <MobileKeyRow label="Updated">{formatRelative(host.updatedAt)}</MobileKeyRow>
          </MobileList>
        </MobileSection>

        <MobileSection title={`Virtual machines (${host.vms.length})`}>
          <MobileGuestList rows={host.vms} hrefBase="/inventory/vms" />
        </MobileSection>

        <MobileSection title={`Containers (${host.containers.length})`}>
          <MobileGuestList rows={host.containers} hrefBase="/inventory/containers" />
        </MobileSection>

        <MobileSection title={`Network interfaces (${host.interfaces.length})`}>
          <MobileInterfaceList rows={host.interfaces} />
        </MobileSection>

        <MobileSection title={`Services (${host.services.length})`}>
          <MobileServiceList rows={host.services} />
        </MobileSection>

        <MobileSection title={`Storage pools (${host.storagePools.length})`}>
          <MobilePoolList rows={host.storagePools} />
        </MobileSection>

        <MobileSection title="Description">
          <MobileCard>
            <DescriptionEditor
              apiPath={`/api/inventory/hosts/${host.id}`}
              initialValue={host.description}
              entity={{ type: "device", id: host.id }}
            />
          </MobileCard>
        </MobileSection>

        <MobileSection title="Tags">
          <MobileCard>
            <TagPicker
              entityType="device"
              entityId={host.id}
              assigned={host.tags.map((t) => ({
                id: t.tag.id,
                name: t.tag.name,
                color: t.tag.color,
              }))}
            />
          </MobileCard>
        </MobileSection>

        {logSources.length > 0 && (
          <AssociatedLogsPanel
            entity="hosts"
            entityId={host.id}
            subjectName={host.name}
            sources={logSources}
          />
        )}

        <MobileMetadataSheet metadata={host.metadata} />
        <AuditTrail entityType="device" entityId={host.id} />
      </MobilePage>
    </>
  );
}
