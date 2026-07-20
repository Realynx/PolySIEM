"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { CircleCheck, Info, Loader2, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionCard } from "@/components/inventory/detail-bits";
import { apiFetch } from "@/components/shared/api-client";
import { CopyButton } from "@/components/ssh/copy-button";

export interface PveVmOption {
  id: string;
  name: string;
  /** e.g. "qemu/104 on finny" */
  detail: string;
}

interface ProxmoxInstallResult {
  installed: boolean;
  alreadyPresent: boolean;
  vmName: string;
  note: string;
}

function ScriptBlock({ script, copyLabel }: { script: string; copyLabel: string }) {
  return (
    <div className="relative">
      <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 pr-10 font-mono text-xs">
        {script}
      </pre>
      <CopyButton value={script} label={copyLabel} className="absolute top-1.5 right-1.5" />
    </div>
  );
}

/**
 * Install helpers: copyable bash/PowerShell scripts, plus one-click install
 * into a Proxmox VM's cloud-init sshkeys.
 */
export function InstallCard({
  keyId,
  scripts,
  pveVms,
}: {
  keyId: string;
  scripts: { bash: string; powershell: string };
  pveVms: PveVmOption[];
}) {
  const router = useRouter();
  const [vmId, setVmId] = useState("");
  const [username, setUsername] = useState("root");
  const [result, setResult] = useState<ProxmoxInstallResult | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const install = useMutation({
    mutationFn: () =>
      apiFetch<ProxmoxInstallResult>(`/api/keys/${keyId}/proxmox-install`, {
        method: "POST",
        body: JSON.stringify({ vmId, username: username.trim() || "root" }),
      }),
    onSuccess: (data) => {
      setPermissionError(null);
      setResult(data);
      toast.success(
        data.alreadyPresent
          ? `Key was already in ${data.vmName}'s cloud-init config`
          : `Key installed into ${data.vmName}'s cloud-init config`,
      );
      router.refresh();
    },
    onError: (err: Error) => {
      setResult(null);
      // The permission message is long and actionable — show it inline, not as a toast.
      if (err.message.includes("VM.Config.Cloudinit")) setPermissionError(err.message);
      else toast.error(err.message);
    },
  });

  return (
    <SectionCard title="Install this key">
      <Tabs defaultValue="linux">
        <TabsList>
          <TabsTrigger value="linux">Linux / macOS</TabsTrigger>
          <TabsTrigger value="windows">Windows</TabsTrigger>
          <TabsTrigger value="proxmox">Proxmox VM</TabsTrigger>
        </TabsList>
        <TabsContent value="linux" className="space-y-3 pt-2">
          <p className="text-sm text-muted-foreground">
            Run on the target machine as the user who should accept this key. Safe to run twice —
            it skips keys that are already installed.
          </p>
          <ScriptBlock script={scripts.bash} copyLabel="Copy bash script" />
        </TabsContent>
        <TabsContent value="windows" className="space-y-3 pt-2">
          <p className="text-sm text-muted-foreground">
            For Windows OpenSSH Server. Run in PowerShell as the target user; admin accounts use{" "}
            <span className="font-mono text-xs">administrators_authorized_keys</span> instead (see
            the script comment).
          </p>
          <ScriptBlock script={scripts.powershell} copyLabel="Copy PowerShell script" />
        </TabsContent>
        <TabsContent value="proxmox" className="space-y-3 pt-2">
          <p className="text-sm text-muted-foreground">
            Appends the key to a VM&apos;s cloud-init <span className="font-mono text-xs">sshkeys</span>{" "}
            via the Proxmox API and records the deployment. Applies on the next boot, and only to
            VMs that use cloud-init.
          </p>
          {pveVms.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No Proxmox-synced VMs in the inventory — connect a Proxmox integration first.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
                <div className="space-y-2">
                  <Label>Virtual machine</Label>
                  <Select value={vmId} onValueChange={setVmId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pick a VM" />
                    </SelectTrigger>
                    <SelectContent>
                      {pveVms.map((vm) => (
                        <SelectItem key={vm.id} value={vm.id}>
                          {vm.name} <span className="text-muted-foreground">({vm.detail})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pve-user">Cloud-init user</Label>
                  <Input id="pve-user" value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
              </div>
              <Button disabled={!vmId || install.isPending} onClick={() => install.mutate()}>
                {install.isPending ? <Loader2 className="animate-spin" /> : <Rocket className="size-4" />}
                Install via Proxmox
              </Button>
              {permissionError && (
                <Alert variant="destructive">
                  <Info className="size-4" />
                  <AlertTitle>The Proxmox token can&apos;t write cloud-init config</AlertTitle>
                  <AlertDescription className="break-words">{permissionError}</AlertDescription>
                </Alert>
              )}
              {result && (
                <Alert>
                  <CircleCheck className="size-4" />
                  <AlertTitle>
                    {result.alreadyPresent
                      ? `Already present on ${result.vmName}`
                      : `Installed on ${result.vmName}`}
                  </AlertTitle>
                  <AlertDescription>{result.note}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </SectionCard>
  );
}
