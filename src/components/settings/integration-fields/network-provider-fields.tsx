import type { OtxFeedValue } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { IntegrationFieldsProps } from "./types";

export function NetworkProviderFields({ form, set }: IntegrationFieldsProps) {
  switch (form.type) {
    case "OPNSENSE":
      return (
        <div className="space-y-4 rounded-md border p-3">
          <p className="text-sm font-medium">Bandwidth tracking</p>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="opn-bandwidth">Poll traffic counters</Label>
              <p className="text-xs text-muted-foreground">
                Read the firewall&apos;s per-rule and per-interface byte counters to chart bandwidth
                through networks and routes. Needs the read-only privileges{" "}
                <strong>Diagnostics: Firewall statistics</strong> and <strong>Reporting: Traffic</strong>.
              </p>
            </div>
            <Switch id="opn-bandwidth" checked={form.bandwidthPolling} onCheckedChange={(value) => set("bandwidthPolling", value)} />
          </div>
          {form.bandwidthPolling && (
            <div className="grid gap-2">
              <Label htmlFor="opn-bandwidth-interval">Poll interval (minutes)</Label>
              <Input id="opn-bandwidth-interval" type="number" min={1} max={60} value={form.bandwidthPollMinutes} onChange={(event) => set("bandwidthPollMinutes", event.target.value)} className="max-w-32" />
            </div>
          )}
        </div>
      );
    case "OTX":
      return (
        <div className="grid gap-2">
          <Label htmlFor="otx-feed">Pulse feed</Label>
          <Select value={form.otxFeed} onValueChange={(value) => set("otxFeed", value as OtxFeedValue)}>
            <SelectTrigger id="otx-feed" className="max-w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="activity">Activity — your account&apos;s feed (recommended)</SelectItem>
              <SelectItem value="subscribed">Subscribed — full pulses, can be very slow</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Log cross-matching uses the indicators from this feed&apos;s latest reports. The subscribed
            feed inlines complete indicator lists and often times out for accounts following AlienVault
            (single pulses exceed 10&nbsp;MB) — stick with Activity unless your subscriptions are small.
          </p>
        </div>
      );
    case "CLOUDFLARE":
      return (
        <div className="space-y-4 rounded-md border p-3">
          <p className="text-sm font-medium">Configuration evidence</p>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="cloudflare-dns">Include zones and DNS records</Label>
              <p className="text-xs text-muted-foreground">Maps proxied records and tunnel CNAMEs to their published hostnames.</p>
            </div>
            <Switch id="cloudflare-dns" checked={form.cloudflareIncludeDns} onCheckedChange={(value) => set("cloudflareIncludeDns", value)} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="cloudflare-connections">Include connector status</Label>
              <p className="text-xs text-muted-foreground">Shows active tunnel connectors and Cloudflare edge locations when the token permits it.</p>
            </div>
            <Switch id="cloudflare-connections" checked={form.cloudflareIncludeConnections} onCheckedChange={(value) => set("cloudflareIncludeConnections", value)} />
          </div>
        </div>
      );
    case "TAILSCALE":
      return (
        <div className="space-y-4 rounded-md border p-3">
          <p className="text-sm font-medium">Network evidence</p>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="tailscale-routes">Include subnet and exit-node routes</Label>
              <p className="text-xs text-muted-foreground">Shows which Tailscale devices advertise or currently provide routes into your other networks.</p>
            </div>
            <Switch id="tailscale-routes" checked={form.tailscaleIncludeRoutes} onCheckedChange={(value) => set("tailscaleIncludeRoutes", value)} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="tailscale-dns">Include DNS configuration</Label>
              <p className="text-xs text-muted-foreground">Maps MagicDNS, global resolvers, search domains, and restricted split-DNS domains.</p>
            </div>
            <Switch id="tailscale-dns" checked={form.tailscaleIncludeDns} onCheckedChange={(value) => set("tailscaleIncludeDns", value)} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="tailscale-policy">Include access policy</Label>
              <p className="text-xs text-muted-foreground">Reads grants, ACLs, named hosts, app connectors, services, and route auto-approvers.</p>
            </div>
            <Switch id="tailscale-policy" checked={form.tailscaleIncludePolicy} onCheckedChange={(value) => set("tailscaleIncludePolicy", value)} />
          </div>
        </div>
      );
    default:
      return null;
  }
}
