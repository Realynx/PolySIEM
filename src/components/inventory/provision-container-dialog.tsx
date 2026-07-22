"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { pushWithNavigationFeedback } from "@/components/shell/navigation-feedback";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Box, Info, Loader2, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiSend } from "./client-api";

interface Target {
  integrationId: string;
  integrationName: string;
  provider: string;
  nodes: { id: string; label: string; online: boolean }[];
  error: string | null;
}

interface Options {
  nextVmid: number;
  storages: { id: string; label: string; availableBytes: number | null }[];
  templates: { id: string; label: string }[];
  networks: { id: string; label: string }[];
}

interface SshKeyOption {
  id: string;
  name: string;
  fingerprint: string;
}

interface Result {
  inventoryId: string | null;
  hostname: string;
  vmid: number;
}

const NO_KEY = "__none";

function provisionReady(fields: string[], ipv4Mode: "dhcp" | "static", ipv4Address: string, gateway: string): boolean {
  return fields.every(Boolean) && (ipv4Mode === "dhcp" || Boolean(ipv4Address.trim() && gateway.trim()));
}

function useProvisionContainerForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [integrationId, setIntegrationId] = useState("");
  const [node, setNode] = useState("");
  const [vmid, setVmid] = useState("");
  const [hostname, setHostname] = useState("");
  const [template, setTemplate] = useState("");
  const [rootStorage, setRootStorage] = useState("");
  const [diskGiB, setDiskGiB] = useState("8");
  const [cores, setCores] = useState("1");
  const [memoryMiB, setMemoryMiB] = useState("512");
  const [swapMiB, setSwapMiB] = useState("512");
  const [bridge, setBridge] = useState("");
  const [ipv4Mode, setIpv4Mode] = useState<"dhcp" | "static">("dhcp");
  const [ipv4Address, setIpv4Address] = useState("");
  const [gateway, setGateway] = useState("");
  const [vlanTag, setVlanTag] = useState("");
  const [sshKeyId, setSshKeyId] = useState(NO_KEY);
  const [unprivileged, setUnprivileged] = useState(true);
  const [start, setStart] = useState(true);
  const [firewall, setFirewall] = useState(true);

  const targets = useQuery({
    queryKey: ["container-provisioning-targets"],
    queryFn: () => apiSend<Target[]>("/api/admin/provisioning/targets", "GET"),
    enabled: open,
    staleTime: 30_000,
  });
  const keys = useQuery({
    queryKey: ["ssh-key-options"],
    queryFn: () => apiSend<SshKeyOption[]>("/api/keys", "GET"),
    enabled: open,
    staleTime: 30_000,
  });
  const options = useQuery({
    queryKey: ["container-provisioning-options", integrationId, node],
    queryFn: () =>
      apiSend<Options>(
        `/api/admin/provisioning/containers/options?integrationId=${encodeURIComponent(integrationId)}&node=${encodeURIComponent(node)}`,
        "GET",
      ),
    enabled: open && Boolean(integrationId && node),
  });

  useEffect(() => {
    if (!open || integrationId || !targets.data?.length) return;
    const target = targets.data.find((item) => item.nodes.some((candidate) => candidate.online)) ?? targets.data[0];
    setIntegrationId(target.integrationId);
    setNode(target.nodes.find((candidate) => candidate.online)?.id ?? target.nodes[0]?.id ?? "");
  }, [integrationId, open, targets.data]);

  useEffect(() => {
    if (!options.data) return;
    setVmid(String(options.data.nextVmid));
    setTemplate(options.data.templates[0]?.id ?? "");
    setRootStorage(options.data.storages[0]?.id ?? "");
    setBridge(options.data.networks[0]?.id ?? "");
  }, [options.data]);

  const selectedTarget = targets.data?.find((item) => item.integrationId === integrationId);
  const canSubmit = provisionReady(
    [integrationId, node, vmid, hostname.trim(), template, rootStorage, bridge],
    ipv4Mode,
    ipv4Address,
    gateway,
  );

  const create = useMutation({
    mutationFn: () =>
      apiSend<Result>("/api/admin/provisioning/containers", "POST", {
        integrationId,
        node,
        vmid: Number(vmid),
        hostname: hostname.trim(),
        template,
        rootStorage,
        diskGiB: Number(diskGiB),
        cores: Number(cores),
        memoryMiB: Number(memoryMiB),
        swapMiB: Number(swapMiB),
        bridge,
        ipv4Mode,
        ...(ipv4Mode === "static"
          ? { ipv4Address: ipv4Address.trim(), gateway: gateway.trim() }
          : {}),
        ...(vlanTag ? { vlanTag: Number(vlanTag) } : {}),
        ...(sshKeyId !== NO_KEY ? { sshKeyId } : {}),
        unprivileged,
        start,
        firewall,
      }),
    onSuccess: (result) => {
      toast.success(`Provisioned ${result.hostname} as CT ${result.vmid}`);
      setOpen(false);
      if (result.inventoryId) {
        pushWithNavigationFeedback(router, `/inventory/containers/${result.inventoryId}`);
      }
      else router.refresh();
    },
    onError: (err: Error) => toast.error(err.message, { duration: 10_000 }),
  });

  function changeIntegration(value: string) {
    const target = targets.data?.find((item) => item.integrationId === value);
    setIntegrationId(value);
    setNode(target?.nodes.find((candidate) => candidate.online)?.id ?? target?.nodes[0]?.id ?? "");
    setVmid("");
  }

  return {
    open, setOpen, integrationId, node, setNode, vmid, setVmid, hostname, setHostname, template, setTemplate,
    rootStorage, setRootStorage, diskGiB, setDiskGiB, cores, setCores, memoryMiB, setMemoryMiB, swapMiB,
    setSwapMiB, bridge, setBridge, ipv4Mode, setIpv4Mode, ipv4Address, setIpv4Address, gateway, setGateway,
    vlanTag, setVlanTag, sshKeyId, setSshKeyId, unprivileged, setUnprivileged, start, setStart, firewall,
    setFirewall, targets, keys, options, selectedTarget, canSubmit, create, changeIntegration,
  };
}

export function ProvisionContainerDialog() {
  const {
    open, setOpen, integrationId, node, setNode, vmid, setVmid, hostname, setHostname, template, setTemplate,
    rootStorage, setRootStorage, diskGiB, setDiskGiB, cores, setCores, memoryMiB, setMemoryMiB, swapMiB,
    setSwapMiB, bridge, setBridge, ipv4Mode, setIpv4Mode, ipv4Address, setIpv4Address, gateway, setGateway,
    vlanTag, setVlanTag, sshKeyId, setSshKeyId, unprivileged, setUnprivileged, start, setStart, firewall,
    setFirewall, targets, keys, options, selectedTarget, canSubmit, create, changeIntegration,
  } = useProvisionContainerForm();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Rocket />
          Provision container
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Provision an LXC container</DialogTitle>
          <DialogDescription>
            Create a container through a supported compute integration. PolySIEM waits for the provider task, then syncs the new container into inventory.
          </DialogDescription>
        </DialogHeader>

        {targets.isLoading ? (
          <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Discovering providers…
          </div>
        ) : !targets.data?.length ? (
          <Alert>
            <Info />
            <AlertTitle>No provisioning-capable integration</AlertTitle>
            <AlertDescription>
              Add and enable a <Link href="/settings/integrations">Proxmox integration</Link> first. Other compute providers will appear here when their PolySIEM driver advertises container provisioning.
            </AlertDescription>
          </Alert>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Integration">
                <Select value={integrationId} onValueChange={changeIntegration}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select provider" /></SelectTrigger>
                  <SelectContent>
                    {targets.data.map((target) => (
                      <SelectItem key={target.integrationId} value={target.integrationId}>
                        {target.integrationName} ({target.provider})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Node">
                <Select value={node} onValueChange={(value) => { setNode(value); setVmid(""); }}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select node" /></SelectTrigger>
                  <SelectContent>
                    {selectedTarget?.nodes.map((item) => (
                      <SelectItem key={item.id} value={item.id} disabled={!item.online}>
                        {item.label}{item.online ? "" : " (offline)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="VMID" htmlFor="provision-vmid">
                <Input id="provision-vmid" type="number" min={100} value={vmid} onChange={(event) => setVmid(event.target.value)} />
              </Field>
            </div>

            <ProvisionErrors
              targetError={selectedTarget?.error ?? null}
              optionsError={options.error?.message ?? null}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Hostname" htmlFor="provision-hostname">
                <Input id="provision-hostname" value={hostname} onChange={(event) => setHostname(event.target.value)} placeholder="app-server" autoComplete="off" />
              </Field>
              <Field label="OS template">
                <Select value={template} onValueChange={setTemplate} disabled={options.isLoading}>
                  <SelectTrigger className="w-full"><SelectValue placeholder={options.isLoading ? "Loading…" : "No downloaded templates"} /></SelectTrigger>
                  <SelectContent>{options.data?.templates.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Root storage">
                <Select value={rootStorage} onValueChange={setRootStorage} disabled={options.isLoading}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select storage" /></SelectTrigger>
                  <SelectContent>{options.data?.storages.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Network bridge">
                <Select value={bridge} onValueChange={setBridge} disabled={options.isLoading}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select bridge" /></SelectTrigger>
                  <SelectContent>{options.data?.networks.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              <NumberField id="provision-disk" label="Disk (GiB)" min={1} value={diskGiB} setValue={setDiskGiB} />
              <NumberField id="provision-cores" label="CPU cores" min={1} value={cores} setValue={setCores} />
              <NumberField id="provision-memory" label="Memory (MiB)" min={64} value={memoryMiB} setValue={setMemoryMiB} />
              <NumberField id="provision-swap" label="Swap (MiB)" min={0} value={swapMiB} setValue={setSwapMiB} />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="IPv4 configuration">
                <Select value={ipv4Mode} onValueChange={(value) => setIpv4Mode(value as "dhcp" | "static")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="dhcp">DHCP</SelectItem><SelectItem value="static">Static</SelectItem></SelectContent>
                </Select>
              </Field>
              {ipv4Mode === "static" && (
                <>
                  <Field label="IPv4 CIDR" htmlFor="provision-ip"><Input id="provision-ip" value={ipv4Address} onChange={(event) => setIpv4Address(event.target.value)} placeholder="10.0.20.50/24" /></Field>
                  <Field label="Gateway" htmlFor="provision-gateway"><Input id="provision-gateway" value={gateway} onChange={(event) => setGateway(event.target.value)} placeholder="10.0.20.1" /></Field>
                </>
              )}
              <Field label="VLAN tag (optional)" htmlFor="provision-vlan"><Input id="provision-vlan" type="number" min={1} max={4094} value={vlanTag} onChange={(event) => setVlanTag(event.target.value)} placeholder="20" /></Field>
            </div>

            <Field label="SSH public key">
              <Select value={sshKeyId} onValueChange={setSshKeyId} disabled={keys.isLoading}>
                <SelectTrigger className="w-full"><SelectValue placeholder="No key" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_KEY}>No key</SelectItem>
                  {keys.data?.map((key) => <SelectItem key={key.id} value={key.id}>{key.name} · {key.fingerprint}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">The public key is injected for root during container creation. PolySIEM never sends a private key.</p>
            </Field>

            <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
              <CheckOption id="provision-unprivileged" label="Unprivileged container" checked={unprivileged} setChecked={setUnprivileged} />
              <CheckOption id="provision-start" label="Start after creation" checked={start} setChecked={setStart} />
              <CheckOption id="provision-firewall" label="Enable NIC firewall" checked={firewall} setChecked={setFirewall} />
            </div>

            <Alert>
              <Box />
              <AlertTitle>Provider-side change</AlertTitle>
              <AlertDescription>Creation can take a few minutes. Closing this dialog does not cancel a task already accepted by Proxmox.</AlertDescription>
            </Alert>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={create.isPending}>Cancel</Button>
              <ProvisionSubmitButton
                ready={canSubmit}
                loadingOptions={options.isLoading}
                pending={create.isPending}
              />
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProvisionErrors({
  targetError,
  optionsError,
}: {
  targetError: string | null;
  optionsError: string | null;
}) {
  return (
    <>
      {targetError && (
        <Alert variant="destructive"><Info /><AlertTitle>Provider discovery failed</AlertTitle><AlertDescription>{targetError}</AlertDescription></Alert>
      )}
      {optionsError && (
        <Alert variant="destructive"><Info /><AlertTitle>Could not load node options</AlertTitle><AlertDescription>{optionsError}</AlertDescription></Alert>
      )}
    </>
  );
}

function ProvisionSubmitButton({ ready, loadingOptions, pending }: { ready: boolean; loadingOptions: boolean; pending: boolean }) {
  return (
    <Button type="submit" disabled={!ready || loadingOptions || pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Rocket />}
      {pending ? "Provisioning…" : "Create container"}
    </Button>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label htmlFor={htmlFor}>{label}</Label>{children}</div>;
}

function NumberField({ id, label, min, value, setValue }: { id: string; label: string; min: number; value: string; setValue: (value: string) => void }) {
  return <Field label={label} htmlFor={id}><Input id={id} type="number" min={min} value={value} onChange={(event) => setValue(event.target.value)} /></Field>;
}

function CheckOption({ id, label, checked, setChecked }: { id: string; label: string; checked: boolean; setChecked: (value: boolean) => void }) {
  return <div className="flex items-center gap-2"><Checkbox id={id} checked={checked} onCheckedChange={(value) => setChecked(value === true)} /><Label htmlFor={id} className="font-normal">{label}</Label></div>;
}
