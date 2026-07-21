import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SetupGuide } from "../integration-form-presentation";
import type { IntegrationStateFieldsProps } from "./types";

export function EdgeNatFields({ form, setForm, set, isEdit }: IntegrationStateFieldsProps) {
  if (form.type !== "EDGE_NAT_SERVER") return null;
  const usesSingleInterface =
    form.edgePublicInterface.trim() !== "" &&
    form.edgePublicInterface.trim() === form.edgeOutboundInterface.trim();

  return (
    <div className="space-y-4 rounded-md border p-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">Edge NAT traffic path</p>
        <p className="text-xs text-muted-foreground">
          The SSH edge server can forward back out through the same WAN interface or through a separate tunnel interface.
        </p>
      </div>
      {!isEdit && <SetupGuide type="EDGE_NAT_SERVER" />}
      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="space-y-0.5">
          <Label htmlFor="edge-single-interface">Use one interface for both directions</Label>
          <p className="text-xs text-muted-foreground">
            Choose this for a one-arm NAT proxy where traffic arrives on the WAN interface and is forwarded to a public target through that same WAN interface.
          </p>
        </div>
        <Switch
          id="edge-single-interface"
          checked={usesSingleInterface}
          onCheckedChange={(checked) => setForm((current) => ({
            ...current,
            edgeOutboundInterface: checked
              ? current.edgePublicInterface
              : current.edgeOutboundInterface.trim() === current.edgePublicInterface.trim()
                ? "tailscale0"
                : current.edgeOutboundInterface,
          }))}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="edge-public-interface">Listener interface</Label>
          <Input
            id="edge-public-interface"
            value={form.edgePublicInterface}
            onChange={(event) => {
              const value = event.target.value;
              setForm((current) => ({
                ...current,
                edgePublicInterface: value,
                ...(current.edgePublicInterface.trim() === current.edgeOutboundInterface.trim()
                  ? { edgeOutboundInterface: value }
                  : {}),
              }));
            }}
            placeholder="eth0"
            required
          />
          <p className="text-xs text-muted-foreground">Receives connections sent to the edge server&apos;s public address.</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="edge-outbound-interface">Target-path interface</Label>
          <Input
            id="edge-outbound-interface"
            value={form.edgeOutboundInterface}
            onChange={(event) => set("edgeOutboundInterface", event.target.value)}
            placeholder={usesSingleInterface ? form.edgePublicInterface || "eth0" : "tailscale0"}
            disabled={usesSingleInterface}
            required
          />
          <p className="text-xs text-muted-foreground">
            {usesSingleInterface
              ? <>Same WAN interface as the listener; suitable when the target is reached through the public Internet.</>
              : <>Use <code>tailscale0</code> or another tunnel only when that interface leads toward the target.</>}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="space-y-0.5">
          <Label htmlFor="edge-ip-forwarding">Enable IPv4 forwarding when rules are applied</Label>
          <p className="text-xs text-muted-foreground">
            Required for routed NAT traffic. PolySIEM changes only the runtime forwarding flag and its own firewall chains.
          </p>
        </div>
        <Switch id="edge-ip-forwarding" checked={form.edgeEnableIpForwarding} onCheckedChange={(value) => set("edgeEnableIpForwarding", value)} />
      </div>
    </div>
  );
}
