import Link from "next/link";
import { KeyRound } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { listSshKeys } from "@/lib/services/ssh-keys";
import { formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ListCard } from "@/components/inventory/list-card";
import { AddKeyDialog } from "@/components/ssh/add-key-dialog";
import { GenerateKeyDialog } from "@/components/ssh/generate-key-dialog";
import { DeleteKeyButton } from "@/components/ssh/delete-key-button";
import { CopyButton } from "@/components/ssh/copy-button";
import { keyTypeLabel, shortFingerprint } from "@/components/ssh/key-type";

export const dynamic = "force-dynamic";

export const metadata = { title: "SSH keys" };

export default async function SshKeysPage() {
  await requirePageUser();
  const keys = await listSshKeys();

  const actions = (
    <>
      <GenerateKeyDialog />
      <AddKeyDialog />
    </>
  );

  return (
    <div>
      <PageHeader
        title="SSH keys"
        description="Document which public keys exist, who owns them, and which machines they unlock. Private keys are never stored."
        actions={actions}
      />
      {keys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No SSH keys documented yet"
          description="Paste the public keys already scattered across your machines (~/.ssh/*.pub, authorized_keys) to document them — or generate a fresh keypair with install scripts for every OS."
          action={<div className="flex gap-2">{actions}</div>}
        />
      ) : (
        <ListCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="hidden lg:table-cell">Fingerprint</TableHead>
                <TableHead className="hidden md:table-cell">Owner</TableHead>
                <TableHead className="hidden xl:table-cell">Comment</TableHead>
                <TableHead className="text-right">Machines</TableHead>
                <TableHead className="hidden lg:table-cell">Added</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell>
                    <Link
                      href={`/keys/${key.id}`}
                      className="font-medium underline-offset-4 hover:text-primary hover:underline"
                    >
                      {key.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{keyTypeLabel(key.keyType, key.bits)}</Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span className="inline-flex items-center gap-1">
                      <span className="font-mono text-xs text-muted-foreground">
                        {shortFingerprint(key.fingerprint)}
                      </span>
                      <CopyButton value={key.fingerprint} label="Copy fingerprint" />
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{key.ownerLabel ?? "—"}</TableCell>
                  <TableCell className="hidden max-w-48 truncate font-mono text-xs text-muted-foreground xl:table-cell">
                    {key.comment ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{key.deploymentCount}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {formatRelative(key.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DeleteKeyButton keyId={key.id} name={key.name} deploymentCount={key.deploymentCount} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ListCard>
      )}
    </div>
  );
}
