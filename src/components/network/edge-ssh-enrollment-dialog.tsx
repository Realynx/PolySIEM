"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Check, Loader2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { buildSshBootstrapCommand } from "@/lib/ssh/bootstrap";
import { apiFetch } from "@/components/shared/api-client";
import { CopyButton } from "@/components/ssh/copy-button";
import { preferredHostKeyFingerprint } from "@/components/ssh/host-key-selection";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EDGE_NETWORKS_QUERY_KEY, type EdgeNatServer } from "./edge-networks-types";
import { enrollmentBlocker } from "./edge-relay-presentation";

interface HostKeyProbe {
  host: string;
  port: number;
  keys: Array<{ algorithm: string; fingerprint: string }>;
  enrolledFingerprint: string | null;
}

export function SshEnrollmentDialog({ server, open, onOpenChange }: { server: EdgeNatServer; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [selectedFingerprint, setSelectedFingerprint] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const settings = server.settings ?? {};
  const publicKey = settings.publicKey ?? "";
  const bootstrapCommand = publicKey ? buildSshBootstrapCommand(publicKey) : "";
  const hostKeyQuery = useQuery({
    queryKey: ["edge-server-host-key", server.id],
    queryFn: () => apiFetch<HostKeyProbe>(`/api/network/edge-networks/servers/${server.id}/host-key`),
    enabled: open,
    retry: false,
  });
  const selected = preferredHostKeyFingerprint(
    selectedFingerprint,
    hostKeyQuery.data?.enrolledFingerprint,
    hostKeyQuery.data?.keys ?? [],
  );
  const enrollMutation = useMutation({
    mutationFn: ({ fingerprint, username }: { fingerprint: string; username: string }) =>
      apiFetch<{ installed: boolean; detail: string }>(`/api/network/edge-networks/servers/${server.id}/provision`, {
        method: "POST",
        body: JSON.stringify({ adminUsername: username, fingerprint }),
      }),
    onSuccess: (result) => {
      toast.success(result.detail || "Relay service installed and SSH verified");
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(`Could not install the relay service: ${error.message}`),
  });
  const blocker = enrollmentBlocker({ publicKey, username: adminUsername, selected, scanning: hostKeyQuery.isFetching });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Trust {server.name} and install the relay service</DialogTitle>
          <DialogDescription>Three steps, about a minute. You authorize PolySIEM&apos;s dedicated key once, confirm the server is the one you expect, and PolySIEM installs the restricted relay service (nftables NAT and the WireGuard listener) for you.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <EnrollmentStep number="1" title="Authorize one setup connection">
            <div className="grid gap-2">
              <Label htmlFor={`edge-admin-${server.id}`}>Existing SSH administrator</Label>
              <Input
                id={`edge-admin-${server.id}`}
                value={adminUsername}
                onChange={(event) => setAdminUsername(event.target.value)}
                placeholder="ubuntu"
                autoComplete="username"
                maxLength={32}
              />
              <p className="text-xs text-muted-foreground">Use the account you normally SSH into. It must be root or have passwordless <code>sudo</code> for this one installation. The username is sent only for this request and is not saved.</p>
            </div>
            <p className="text-sm text-muted-foreground">Sign in to that account and run this short command. It adds a forced, temporary installer key—not a general shell key.</p>
            <EnrollmentCommand bootstrapCommand={bootstrapCommand} publicKey={publicKey} />
            {settings.publicKeyFingerprint && <p className="text-xs text-muted-foreground">PolySIEM key fingerprint: <code>{settings.publicKeyFingerprint}</code></p>}
          </EnrollmentStep>

          <EnrollmentScanStep probeQuery={hostKeyQuery} selected={selected} onSelect={setSelectedFingerprint} />

          <EnrollmentStep number="3" title="Let PolySIEM install the relay service">
            <p className="text-sm text-muted-foreground">PolySIEM rescans and pins the selected host identity, connects through the temporary installer key, installs the restricted <code>polysiem-edge</code> service, removes the temporary admin authorization, and verifies the service.</p>
            {enrollMutation.isPending && (
              <Alert><Loader2 className="animate-spin" /><AlertTitle>Installing the restricted relay service</AlertTitle><AlertDescription>Keep this window open. PolySIEM is connecting over pinned SSH, installing the helper, removing its temporary setup access, and checking the result.</AlertDescription></Alert>
            )}
          </EnrollmentStep>
        </div>
        <DialogFooter className="items-center">
          {blocker && !enrollMutation.isPending && (
            <p className="mr-auto text-xs text-muted-foreground" role="status">{blocker}</p>
          )}
          <DialogClose asChild><Button type="button" variant="outline">Finish later</Button></DialogClose>
          <Button
            disabled={blocker !== null || enrollMutation.isPending}
            onClick={() => selected && enrollMutation.mutate({ fingerprint: selected, username: adminUsername.trim() })}
          >
            {enrollMutation.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            {enrollMutation.isPending ? "Installing service…" : "Trust host and install service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Step ②: what the host presents, and which fingerprint gets pinned. */
function EnrollmentScanStep({
  probeQuery,
  selected,
  onSelect,
}: {
  probeQuery: UseQueryResult<HostKeyProbe>;
  selected: string;
  onSelect: (fingerprint: string) => void;
}) {
  const probe = probeQuery.data;
  return (
    <EnrollmentStep number="2" title="Scan the server identity">
      <p className="text-sm text-muted-foreground">Compare an observed fingerprint with the server console before trusting it. Pinning this key prevents a changed or impersonated SSH host from being accepted silently.</p>
      {probeQuery.isLoading && <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>}
      {probeQuery.isError && (
        <Alert
          variant="destructive"
          aria-label={`Could not scan the SSH host key: ${(probeQuery.error as Error).message}`}
        >
          <TriangleAlert />
          <AlertTitle>Could not scan the SSH host key:</AlertTitle>
          <AlertDescription>{` ${(probeQuery.error as Error).message}`}</AlertDescription>
        </Alert>
      )}
      {probe && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Observed at <code>{probe.host}:{probe.port}</code></p>
          {probe.keys.length === 0 ? <p className="text-sm text-warning">No host keys were returned.</p> : probe.keys.map((key) => (
            <EnrollmentHostKeyOption
              key={`${key.algorithm}:${key.fingerprint}`}
              algorithm={key.algorithm}
              fingerprint={key.fingerprint}
              active={selected === key.fingerprint}
              onSelect={() => onSelect(key.fingerprint)}
            />
          ))}
        </div>
      )}
      <Button type="button" variant="outline" size="sm" disabled={probeQuery.isFetching} onClick={() => void probeQuery.refetch()}><RefreshCw className={cn(probeQuery.isFetching && "animate-spin")} /> Scan again</Button>
    </EnrollmentStep>
  );
}

function EnrollmentHostKeyOption({
  algorithm,
  fingerprint,
  active,
  onSelect,
}: {
  algorithm: string;
  fingerprint: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" onClick={onSelect} className={cn("flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent", active && "border-primary bg-primary/5")}>
      <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", active && "border-primary bg-primary text-primary-foreground")}>{active && <Check className="size-3" />}</span>
      <span className="min-w-0"><span className="block text-xs font-medium uppercase text-muted-foreground">{algorithm}</span><code className="block break-all text-xs">{fingerprint}</code></span>
    </button>
  );
}

/** The setup one-liner, degrading to the raw key and then to an error. */
function EnrollmentCommand({ bootstrapCommand, publicKey }: { bootstrapCommand: string; publicKey: string }) {
  if (bootstrapCommand) return <CopyBlock value={bootstrapCommand} label="Setup command" />;
  if (publicKey) {
    return (
      <>
        <CopyBlock value={publicKey} label="Public key" />
        <p className="text-xs text-warning">The setup command could not be generated. Recreate this integration before continuing.</p>
      </>
    );
  }
  return (
    <Alert variant="destructive"><TriangleAlert /><AlertTitle>Generated public key unavailable</AlertTitle><AlertDescription>Edit or recreate the integration before continuing.</AlertDescription></Alert>
  );
}

function EnrollmentStep({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return <section className="grid gap-3 sm:grid-cols-[2rem_1fr]"><div className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">{number}</div><div className="min-w-0 space-y-3"><h3 className="font-medium">{title}</h3>{children}</div></section>;
}

function CopyBlock({ value, label }: { value: string; label: string }) {
  return <div className="relative rounded-lg bg-muted p-3 pr-12"><pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all text-xs"><code>{value}</code></pre><CopyButton value={value} label={`Copy ${label}`} className="absolute right-2 top-2" /></div>;
}
