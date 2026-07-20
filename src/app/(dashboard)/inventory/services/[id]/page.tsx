import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink, Pencil } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { getService } from "@/lib/services/inventory";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { SourceBadge, StatusBadge } from "@/components/shared/badges";
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
import { TagPicker } from "@/components/inventory/tag-picker";
import { DescriptionEditor } from "@/components/docs/description-editor";
import { isMobileView } from "@/lib/device";
import { MobileServiceDetail } from "@/components/mobile/pages/inventory-detail/mobile-service-detail";

function cloudflareEvidence(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const evidence = metadata as Record<string, unknown>;
  if (evidence.evidence !== "cloudflare-published-route") return null;
  const text = (key: string) => typeof evidence[key] === "string" ? evidence[key] as string : null;
  return {
    accountName: text("accountName"),
    tunnelName: text("tunnelName"),
    hostname: text("hostname"),
    path: text("path"),
    originService: text("originService"),
    capturedAt: text("capturedAt"),
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const svc = await getService(id).catch(() => null);
  return { title: svc ? await anonymizeForDisplay(svc.name) : "Service" };
}

export default async function ServiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  const svcData = await getService(id).catch(() => null);
  if (!svcData) notFound();
  const svc = await anonymizeForDisplay(svcData);
  const evidence = cloudflareEvidence(svc.metadata);

  const initial = {
    name: svc.name,
    url: svc.url ?? "",
    port: svc.port?.toString() ?? "",
    protocol: svc.protocol ?? "",
    deviceId: svc.device?.id ?? "",
    vmId: svc.vm?.id ?? "",
    containerId: svc.container?.id ?? "",
    description: svc.description ?? "",
  };

  if (await isMobileView()) {
    return <MobileServiceDetail svc={svc} evidence={evidence} initial={initial} />;
  }

  return (
    <div>
      <PageHeader
        title={svc.name}
        actions={
          <>
            {svc.url && (
              <Button variant="outline" asChild>
                <a href={svc.url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Open
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
                <Button variant="outline">
                  <Pencil />
                  Edit
                </Button>
              }
            />
            {svc.source === "MANUAL" && (
              <DeleteEntityButton
                apiPath={`/api/inventory/services/${svc.id}`}
                entityLabel={`service “${svc.name}”`}
                redirectTo="/inventory/services"
              />
            )}
          </>
        }
      >
        <div className="-mt-2 flex flex-wrap items-center gap-2">
          {svc.protocol && (
            <Badge variant="secondary" className="uppercase">
              {svc.protocol}
            </Badge>
          )}
          <SourceBadge source={svc.source} />
          <StatusBadge status={svc.status} />
        </div>
      </PageHeader>

      <DetailGrid
        main={
          <SectionCard title="Description">
            <DescriptionEditor
              apiPath={`/api/inventory/services/${svc.id}`}
              initialValue={svc.description}
              entity={{ type: "service", id: svc.id }}
            />
          </SectionCard>
        }
        side={
          <>
            <SectionCard title="Details">
              <SpecList>
                <SpecItem label="URL">
                  {svc.url ? (
                    <a
                      href={svc.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline underline-offset-4"
                    >
                      <span className="max-w-52 truncate">{svc.url}</span>
                      <ExternalLink className="size-3.5 shrink-0" />
                    </a>
                  ) : (
                    <Muted />
                  )}
                </SpecItem>
                <SpecItem label="Port">
                  <Muted>{svc.port}</Muted>
                </SpecItem>
                <SpecItem label="Protocol">
                  <Muted>{svc.protocol?.toUpperCase()}</Muted>
                </SpecItem>
                <SpecItem label="Host">
                  {svc.device ? (
                    <EntityLink href={`/inventory/hosts/${svc.device.id}`}>{svc.device.name}</EntityLink>
                  ) : (
                    <Muted />
                  )}
                </SpecItem>
                <SpecItem label="VM">
                  {svc.vm ? (
                    <EntityLink href={`/inventory/vms/${svc.vm.id}`}>{svc.vm.name}</EntityLink>
                  ) : (
                    <Muted />
                  )}
                </SpecItem>
                <SpecItem label="Container">
                  {svc.container ? (
                    <EntityLink href={`/inventory/containers/${svc.container.id}`}>
                      {svc.container.name}
                    </EntityLink>
                  ) : (
                    <Muted />
                  )}
                </SpecItem>
                <SpecItem label="Created">{formatRelative(svc.createdAt)}</SpecItem>
                <SpecItem label="Updated">{formatRelative(svc.updatedAt)}</SpecItem>
              </SpecList>
            </SectionCard>
            {evidence && (
              <SectionCard title="Discovery evidence">
                <SpecList>
                  <SpecItem label="Evidence">
                    <EntityLink href="/network/edge-networks">Cloudflare published route</EntityLink>
                  </SpecItem>
                  <SpecItem label="Account"><Muted>{evidence.accountName}</Muted></SpecItem>
                  <SpecItem label="Tunnel"><Muted>{evidence.tunnelName}</Muted></SpecItem>
                  <SpecItem label="Published as"><Muted>{evidence.hostname}{evidence.path ? ` ${evidence.path}` : ""}</Muted></SpecItem>
                  <SpecItem label="Origin"><Muted>{evidence.originService}</Muted></SpecItem>
                  <SpecItem label="Observed">{evidence.capturedAt ? formatRelative(evidence.capturedAt) : <Muted />}</SpecItem>
                </SpecList>
              </SectionCard>
            )}
            <SectionCard title="Tags">
              <TagPicker
                entityType="service"
                entityId={svc.id}
                assigned={svc.tags.map((t) => ({
                  id: t.tag.id,
                  name: t.tag.name,
                  color: t.tag.color,
                }))}
              />
            </SectionCard>
            <AuditTrail entityType="service" entityId={svc.id} />
          </>
        }
      />
    </div>
  );
}
