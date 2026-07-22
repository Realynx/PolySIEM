"use client";

import { type FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import type { EdgeNatRule, EdgeNatServer, NatProtocol, NatRuleInput } from "@/components/network/edge-networks-types";
import { isValidNetworkPort } from "@/components/network/edge-network-utils";

/** Add/edit NAT rule form in a bottom sheet, posting to the same endpoints as desktop. */
export function MobileNatRuleSheet({
  server,
  rule,
  onOpenChange,
}: {
  server: EdgeNatServer;
  rule: EdgeNatRule | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(rule?.name ?? "");
  const [protocol, setProtocol] = useState<NatProtocol>(rule?.protocol ?? "tcp");
  const [publicPort, setPublicPort] = useState(rule ? String(rule.publicPort) : "");
  const [targetAddress, setTargetAddress] = useState(rule?.targetAddress ?? "");
  const [targetPort, setTargetPort] = useState(rule ? String(rule.targetPort) : "");
  const [sourceCidr, setSourceCidr] = useState(rule?.sourceCidr ?? "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);

  const mutation = useMutation({
    mutationFn: (input: NatRuleInput) =>
      apiFetch(
        rule
          ? `/api/network/edge-networks/servers/${server.id}/rules/${rule.id}`
          : `/api/network/edge-networks/servers/${server.id}/rules`,
        { method: rule ? "PATCH" : "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      toast.success(`${rule ? "Updated" : "Added"} NAT rule. Apply changes when ready.`);
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["edge-networks"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const publicPortNum = Number(publicPort);
    const targetPortNum = Number(targetPort);
    if (!name.trim() || !targetAddress.trim() || !isValidNetworkPort(publicPortNum) || !isValidNetworkPort(targetPortNum)) {
      toast.error("Enter a name, private target, and valid ports from 1–65535.");
      return;
    }
    mutation.mutate({
      name: name.trim(),
      protocol,
      publicPort: publicPortNum,
      targetAddress: targetAddress.trim(),
      targetPort: targetPortNum,
      sourceCidr: sourceCidr.trim() || undefined,
      enabled,
    });
  };

  const sheet = () => (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`${rule ? "Edit" : "Add"} NAT rule`}
      description={`Publish one listener on ${server.name} and send it to a private lab address.`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4 pb-2">
        <div className="grid gap-1.5">
          <Label htmlFor="m-nat-name">Rule name</Label>
          <Input id="m-nat-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Plex HTTPS" />
        </div>
        <div className="grid grid-cols-[0.7fr_1fr] gap-3">
          <div className="grid gap-1.5">
            <Label>Protocol</Label>
            <Select value={protocol} onValueChange={(value) => setProtocol(value as NatProtocol)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tcp">TCP</SelectItem>
                <SelectItem value="udp">UDP</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="m-nat-public">Edge port</Label>
            <Input
              id="m-nat-public"
              inputMode="numeric"
              value={publicPort}
              onChange={(event) => setPublicPort(event.target.value)}
              placeholder="443"
            />
          </div>
        </div>
        <div className="grid grid-cols-[1fr_0.55fr] gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="m-nat-target">Private target</Label>
            <Input
              id="m-nat-target"
              value={targetAddress}
              onChange={(event) => setTargetAddress(event.target.value)}
              placeholder="10.0.3.20"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="m-nat-target-port">Port</Label>
            <Input
              id="m-nat-target-port"
              inputMode="numeric"
              value={targetPort}
              onChange={(event) => setTargetPort(event.target.value)}
              placeholder="32400"
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="m-nat-cidr">
            Allowed source CIDR <span className="font-normal text-muted-foreground">(recommended)</span>
          </Label>
          <Input
            id="m-nat-cidr"
            value={sourceCidr}
            onChange={(event) => setSourceCidr(event.target.value)}
            placeholder="203.0.113.0/24"
          />
          <p className={cn("text-xs", sourceCidr ? "text-muted-foreground" : "text-warning")}>
            {sourceCidr ? "Only this source range can enter the rule." : "Blank allows traffic from any internet address."}
          </p>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
          <div>
            <Label htmlFor="m-nat-enabled">Rule enabled</Label>
            <p className="text-xs text-muted-foreground">Disabled rules remain saved but are not installed.</p>
          </div>
          <Switch id="m-nat-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="animate-spin" />}
          {rule ? "Save rule" : "Add rule"}
        </Button>
      </form>
    </BottomSheet>
  );
  return sheet();
}
