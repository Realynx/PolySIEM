import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { prisma } from "@/lib/db";
import { getSshKey } from "@/lib/services/ssh-keys";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { buildInstallScripts } from "@/lib/ssh/keys";
import { formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { DetailGrid, Muted, SectionCard, SpecItem, SpecList } from "@/components/inventory/detail-bits";
import { AuditTrail } from "@/components/inventory/audit-trail";
import { CopyButton } from "@/components/ssh/copy-button";
import { DeleteKeyButton } from "@/components/ssh/delete-key-button";
import { DeploymentsCard, type DeploymentRow } from "@/components/ssh/deployments-card";
import { EditKeyDialog } from "@/components/ssh/edit-key-dialog";
import { InstallCard, type PveVmOption } from "@/components/ssh/install-card";
import { keyTypeLabel } from "@/components/ssh/key-type";
import { MobileSshKeyDetail } from "@/components/mobile/pages/security/mobile-ssh-key-detail";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const key = await anonymizeForDisplay(await getSshKey(id).catch(() => null));
  return { title: key?.name ?? "SSH key" };
}

const PVE_EXTERNAL_ID_RE = /^qemu\/(\d+)@(.+)$/;

export default async function SshKeyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  const key = await getSshKey(id).catch(() => null);
  if (!key) notFound();

  const [devices, vms, containers] = await Promise.all([
    prisma.device.findMany({
      where: { status: { not: "REMOVED" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.virtualMachine.findMany({
      where: { status: { not: "REMOVED" } },
      select: { id: true, name: true, source: true, externalId: true },
      orderBy: { name: "asc" },
    }),
    prisma.container.findMany({
      where: { status: { not: "REMOVED" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const pveVms: PveVmOption[] = vms
    .filter((vm) => vm.source === "PROXMOX" && PVE_EXTERNAL_ID_RE.test(vm.externalId ?? ""))
    .map((vm) => {
      const [, vmid, node] = PVE_EXTERNAL_ID_RE.exec(vm.externalId!)!;
      return { id: vm.id, name: vm.name, detail: `qemu/${vmid} on ${node}` };
    });

  const scripts = buildInstallScripts(key.publicKey);
  const deployments: DeploymentRow[] = await anonymizeForDisplay(
    key.deployments.map((d) => ({
      id: d.id,
      entityType: d.entityType,
      username: d.username,
      method: d.method,
      notes: d.notes,
      hostLabel: d.hostLabel,
      device: d.device,
      vm: d.vm,
      container: d.container,
    })),
  );

  if (await isMobileView()) {
    return (
      <MobileSshKeyDetail
        keyRow={key}
        deployments={deployments}
        options={{ devices, vms, containers }}
        scripts={scripts}
        pveVms={pveVms}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={key.name}
        actions={
          <>
            <EditKeyDialog
              keyId={key.id}
              initial={{ name: key.name, ownerLabel: key.ownerLabel, purpose: key.purpose }}
            />
            <DeleteKeyButton
              keyId={key.id}
              name={key.name}
              deploymentCount={key.deployments.length}
              variant="button"
            />
          </>
        }
      >
        <div className="-mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{keyTypeLabel(key.keyType, key.bits)}</Badge>
          {key.ownerLabel && <span className="text-xs text-muted-foreground">owned by {key.ownerLabel}</span>}
          <span className="text-xs text-muted-foreground">added {formatRelative(key.createdAt)}</span>
        </div>
      </PageHeader>

      <DetailGrid
        main={
          <>
            <SectionCard
              title="Public key"
              action={<CopyButton value={key.publicKey} label="Copy public key" />}
            >
              <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs break-all whitespace-pre-wrap">
                {key.publicKey}
              </pre>
            </SectionCard>
            <DeploymentsCard keyId={key.id} deployments={deployments} options={{ devices, vms, containers }} />
            <InstallCard keyId={key.id} scripts={scripts} pveVms={pveVms} />
          </>
        }
        side={
          <>
            <SectionCard title="Details">
              <SpecList>
                <SpecItem label="Fingerprint">
                  <span className="inline-flex max-w-full items-center gap-1">
                    <span className="truncate font-mono text-xs">{key.fingerprint}</span>
                    <CopyButton value={key.fingerprint} label="Copy fingerprint" />
                  </span>
                </SpecItem>
                <SpecItem label="Type">{keyTypeLabel(key.keyType, key.bits)}</SpecItem>
                <SpecItem label="Bits">
                  <Muted>{key.bits}</Muted>
                </SpecItem>
                <SpecItem label="Comment">
                  <Muted>{key.comment && <span className="font-mono text-xs">{key.comment}</span>}</Muted>
                </SpecItem>
                <SpecItem label="Owner">
                  <Muted>{key.ownerLabel}</Muted>
                </SpecItem>
                <SpecItem label="Added">{formatRelative(key.createdAt)}</SpecItem>
                <SpecItem label="Updated">{formatRelative(key.updatedAt)}</SpecItem>
              </SpecList>
            </SectionCard>
            <SectionCard title="Purpose">
              {key.purpose ? (
                <p className="text-sm whitespace-pre-wrap">{key.purpose}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  What is this key for? Add a purpose so future-you knows why it exists.
                </p>
              )}
            </SectionCard>
            <AuditTrail entityType="sshkey" entityId={key.id} />
          </>
        }
      />
    </div>
  );
}
