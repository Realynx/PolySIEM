import { KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AddKeyDialog } from "@/components/ssh/add-key-dialog";
import { GenerateKeyDialog } from "@/components/ssh/generate-key-dialog";
import { keyTypeLabel, shortFingerprint } from "@/components/ssh/key-type";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";

export interface MobileSshKeyRow {
  id: string;
  name: string;
  keyType: string;
  bits: number | null;
  fingerprint: string;
  ownerLabel: string | null;
  deploymentCount: number;
}

/** Phone SSH-key inventory: touch rows into the detail page; existing add/generate dialogs. */
export function MobileSshKeys({ keys }: { keys: MobileSshKeyRow[] }) {
  const actions = (
    <div className="flex gap-2 [&_button]:flex-1">
      <GenerateKeyDialog />
      <AddKeyDialog />
    </div>
  );

  return (
    <>
      <MobilePageHeader title="SSH keys" />
      <MobilePage>
        {keys.length === 0 ? (
          <MobileEmpty
            icon={<KeyRound />}
            title="No SSH keys documented yet"
            description="Paste the public keys already scattered across your machines, or generate a fresh keypair with install scripts."
            action={actions}
          />
        ) : (
          <>
            {actions}
            <MobileSection title={`Keys · ${keys.length}`}>
              <MobileList>
                {keys.map((key) => (
                  <MobileListRow
                    key={key.id}
                    href={`/keys/${key.id}`}
                    title={
                      <>
                        <span className="min-w-0 truncate">{key.name}</span>
                        <Badge variant="secondary" className="shrink-0 px-1 text-[0.6rem]">
                          {keyTypeLabel(key.keyType, key.bits)}
                        </Badge>
                      </>
                    }
                    subtitle={
                      <span className="font-mono">
                        {shortFingerprint(key.fingerprint)}
                        {key.ownerLabel ? ` · ${key.ownerLabel}` : ""}
                      </span>
                    }
                    trailing={<span>{key.deploymentCount}</span>}
                  />
                ))}
              </MobileList>
            </MobileSection>
          </>
        )}
      </MobilePage>
    </>
  );
}
