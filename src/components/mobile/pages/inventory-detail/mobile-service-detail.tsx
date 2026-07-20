import { ExternalLink, Pencil } from "lucide-react";
import type { getService } from "@/lib/services/inventory";
import { formatRelative } from "@/lib/format";
import { SourceBadge, StatusBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
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
import { MobileCard } from "./detail-bits";

type ServiceDetail = Awaited<ReturnType<typeof getService>>;

interface CloudflareEvidence {
  accountName: string | null;
  tunnelName: string | null;
  hostname: string | null;
  path: string | null;
  originService: string | null;
  capturedAt: string | null;
}

/** Phone presentation of /inventory/services/[id]; same payload as desktop. */
export function MobileServiceDetail({
  svc,
  evidence,
  initial,
}: {
  svc: ServiceDetail;
  evidence: CloudflareEvidence | null;
  initial: FormValues;
}) {
  return (
    <>
      <MobilePageHeader
        title={svc.name}
        backHref="/inventory/services"
        actions={
          <>
            {svc.url && (
              <Button variant="ghost" size="icon" aria-label="Open service" asChild>
                <a href={svc.url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                </a>
              </Button>
            )}
            <EntityFormDialog
              entity="services"
              mode="edit"
              entityId={svc.id}
              initial={initial}
              source={svc.source}
              trigger={
                <Button variant="ghost" size="icon" aria-label="Edit service">
                  <Pencil />
                </Button>
              }
            />
            {svc.source === "MANUAL" && (
              <DeleteEntityButton
                apiPath={`/api/inventory/services/${svc.id}`}
                entityLabel={`service “${svc.name}”`}
                redirectTo="/inventory/services"
                iconOnly
              />
            )}
          </>
        }
      />
      <MobilePage>
        <div className="flex flex-wrap items-center gap-1.5">
          {svc.protocol && (
            <Badge variant="secondary" className="uppercase">
              {svc.protocol}
            </Badge>
          )}
          <SourceBadge source={svc.source} />
          <StatusBadge status={svc.status} />
        </div>

        <MobileSection title="Details">
          <MobileList>
            <MobileKeyRow label="URL">
              {svc.url ? (
                <a
                  href={svc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1 text-primary underline-offset-4 active:underline"
                >
                  <span className="min-w-0 break-all">{svc.url}</span>
                  <ExternalLink className="size-3.5 shrink-0" />
                </a>
              ) : (
                <Muted />
              )}
            </MobileKeyRow>
            <MobileKeyRow label="Port" mono>
              <Muted>{svc.port}</Muted>
            </MobileKeyRow>
            <MobileKeyRow label="Protocol">
              <Muted>{svc.protocol?.toUpperCase()}</Muted>
            </MobileKeyRow>
            <MobileKeyRow label="Host">
              {svc.device ? (
                <EntityLink href={`/inventory/hosts/${svc.device.id}`}>{svc.device.name}</EntityLink>
              ) : (
                <Muted />
              )}
            </MobileKeyRow>
            <MobileKeyRow label="VM">
              {svc.vm ? (
                <EntityLink href={`/inventory/vms/${svc.vm.id}`}>{svc.vm.name}</EntityLink>
              ) : (
                <Muted />
              )}
            </MobileKeyRow>
            <MobileKeyRow label="Container">
              {svc.container ? (
                <EntityLink href={`/inventory/containers/${svc.container.id}`}>
                  {svc.container.name}
                </EntityLink>
              ) : (
                <Muted />
              )}
            </MobileKeyRow>
            <MobileKeyRow label="Created">{formatRelative(svc.createdAt)}</MobileKeyRow>
            <MobileKeyRow label="Updated">{formatRelative(svc.updatedAt)}</MobileKeyRow>
          </MobileList>
        </MobileSection>

        {evidence && (
          <MobileSection title="Discovery evidence">
            <MobileList>
              <MobileKeyRow label="Evidence">
                <EntityLink href="/network/edge-networks">Cloudflare published route</EntityLink>
              </MobileKeyRow>
              <MobileKeyRow label="Account">
                <Muted>{evidence.accountName}</Muted>
              </MobileKeyRow>
              <MobileKeyRow label="Tunnel">
                <Muted>{evidence.tunnelName}</Muted>
              </MobileKeyRow>
              <MobileKeyRow label="Published as" mono>
                <Muted>
                  {evidence.hostname}
                  {evidence.path ? ` ${evidence.path}` : ""}
                </Muted>
              </MobileKeyRow>
              <MobileKeyRow label="Origin" mono>
                <Muted>{evidence.originService}</Muted>
              </MobileKeyRow>
              <MobileKeyRow label="Observed">
                {evidence.capturedAt ? formatRelative(evidence.capturedAt) : <Muted />}
              </MobileKeyRow>
            </MobileList>
          </MobileSection>
        )}

        <MobileSection title="Description">
          <MobileCard>
            <DescriptionEditor
              apiPath={`/api/inventory/services/${svc.id}`}
              initialValue={svc.description}
              entity={{ type: "service", id: svc.id }}
            />
          </MobileCard>
        </MobileSection>

        <MobileSection title="Tags">
          <MobileCard>
            <TagPicker
              entityType="service"
              entityId={svc.id}
              assigned={svc.tags.map((t) => ({
                id: t.tag.id,
                name: t.tag.name,
                color: t.tag.color,
              }))}
            />
          </MobileCard>
        </MobileSection>

        <AuditTrail entityType="service" entityId={svc.id} />
      </MobilePage>
    </>
  );
}
