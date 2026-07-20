import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/format";
import { CopyButton } from "@/components/ssh/copy-button";
import { DeleteKeyButton } from "@/components/ssh/delete-key-button";
import {
  DeploymentsCard,
  type DeploymentRow,
  type EntityOptions,
} from "@/components/ssh/deployments-card";
import { EditKeyDialog } from "@/components/ssh/edit-key-dialog";
import { InstallCard, type PveVmOption } from "@/components/ssh/install-card";
import { keyTypeLabel } from "@/components/ssh/key-type";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileKeyRow, MobileList } from "@/components/mobile/ui/mobile-list";

export interface MobileSshKeyDetailProps {
  keyRow: {
    id: string;
    name: string;
    keyType: string;
    bits: number | null;
    fingerprint: string;
    publicKey: string;
    comment: string | null;
    ownerLabel: string | null;
    purpose: string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
  };
  deployments: DeploymentRow[];
  options: EntityOptions;
  scripts: { bash: string; powershell: string };
  pveVms: PveVmOption[];
}

/**
 * Phone SSH-key detail: wrapping mono key material with copy, spec rows, and
 * the existing deployments/install cards (their dialogs present as bottom
 * sheets at phone widths).
 */
export function MobileSshKeyDetail({ keyRow, deployments, options, scripts, pveVms }: MobileSshKeyDetailProps) {
  return (
    <>
      <MobilePageHeader title={keyRow.name} backHref="/keys" />
      <MobilePage className="pb-6">
        <div className="flex flex-wrap items-center gap-2 px-0.5">
          <Badge variant="secondary">{keyTypeLabel(keyRow.keyType, keyRow.bits)}</Badge>
          {keyRow.ownerLabel && (
            <span className="text-xs text-muted-foreground">owned by {keyRow.ownerLabel}</span>
          )}
          <span className="text-xs text-muted-foreground">added {formatRelative(keyRow.createdAt)}</span>
        </div>

        <MobileSection
          title="Public key"
          action={<CopyButton value={keyRow.publicKey} label="Copy public key" />}
        >
          <pre className="rounded-xl border bg-card p-3 font-mono text-xs break-all whitespace-pre-wrap">
            {keyRow.publicKey}
          </pre>
        </MobileSection>

        <MobileSection title="Details">
          <MobileList>
            <MobileKeyRow label="Fingerprint" mono>
              <span className="inline-flex max-w-full items-center gap-1">
                <span className="truncate">{keyRow.fingerprint}</span>
                <CopyButton value={keyRow.fingerprint} label="Copy fingerprint" className="shrink-0" />
              </span>
            </MobileKeyRow>
            <MobileKeyRow label="Type">{keyTypeLabel(keyRow.keyType, keyRow.bits)}</MobileKeyRow>
            <MobileKeyRow label="Bits">{keyRow.bits ?? "—"}</MobileKeyRow>
            <MobileKeyRow label="Comment" mono>
              {keyRow.comment ?? "—"}
            </MobileKeyRow>
            <MobileKeyRow label="Owner">{keyRow.ownerLabel ?? "—"}</MobileKeyRow>
            <MobileKeyRow label="Added">{formatRelative(keyRow.createdAt)}</MobileKeyRow>
            <MobileKeyRow label="Updated">{formatRelative(keyRow.updatedAt)}</MobileKeyRow>
          </MobileList>
        </MobileSection>

        <MobileSection title="Purpose">
          <div className="rounded-xl border bg-card px-3.5 py-3">
            {keyRow.purpose ? (
              <p className="text-sm whitespace-pre-wrap">{keyRow.purpose}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                What is this key for? Add a purpose so future-you knows why it exists.
              </p>
            )}
          </div>
        </MobileSection>

        <DeploymentsCard keyId={keyRow.id} deployments={deployments} options={options} />
        <InstallCard keyId={keyRow.id} scripts={scripts} pveVms={pveVms} />

        <div className="flex gap-2 [&_button]:flex-1">
          <EditKeyDialog
            keyId={keyRow.id}
            initial={{ name: keyRow.name, ownerLabel: keyRow.ownerLabel, purpose: keyRow.purpose }}
          />
          <DeleteKeyButton
            keyId={keyRow.id}
            name={keyRow.name}
            deploymentCount={deployments.length}
            variant="button"
          />
        </div>
      </MobilePage>
    </>
  );
}
