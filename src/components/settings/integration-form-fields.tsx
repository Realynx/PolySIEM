"use client";

import type { Dispatch, SetStateAction } from "react";
import { ShieldCheck } from "lucide-react";
import type { OtxFeedValue } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ES_SETTINGS_DEFAULTS, type FormState } from "./integration-form-model";
import { INTEGRATION_FORM_META, SetupGuide } from "./integration-form-presentation";

interface IntegrationSpecificFieldsProps {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  isEdit: boolean;
  showCredentials: boolean;
}

export function IntegrationSpecificFields({
  form,
  setForm,
  set,
  isEdit,
  showCredentials,
}: IntegrationSpecificFieldsProps) {
  const edgeUsesSingleInterface =
    form.edgePublicInterface.trim() !== "" &&
    form.edgePublicInterface.trim() === form.edgeOutboundInterface.trim();
  const formMeta = INTEGRATION_FORM_META[form.type];

  return (
    <>
      {showCredentials && (
        <div className="space-y-4 rounded-md border p-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">{formMeta.credentialsTitle}</p>
            <p className="text-xs text-muted-foreground">{formMeta.credentialsHint}</p>
          </div>
          <SetupGuide type={form.type} />
          {form.type === "PROXMOX" && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="pve-token-id">API token ID</Label>
                <Input
                  id="pve-token-id"
                  value={form.tokenId}
                  onChange={(e) => set("tokenId", e.target.value)}
                  placeholder="polysiem@pve!sync"
                  required={showCredentials && !isEdit}
                />
                <p className="text-xs text-muted-foreground">
                  Include the full user and token name, separated by <code>!</code>.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pve-token-secret">API token secret</Label>
                <Input
                  id="pve-token-secret"
                  type="password"
                  value={form.tokenSecret}
                  onChange={(e) => set("tokenSecret", e.target.value)}
                  placeholder="Paste the generated secret"
                  required={showCredentials && !isEdit}
                />
                <p className="text-xs text-muted-foreground">
                  Proxmox shows this secret once when it creates the token.
                </p>
              </div>
            </>
          )}
          {form.type === "OPNSENSE" && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="opn-key">API key</Label>
                <Input
                  id="opn-key"
                  value={form.apiKey}
                  onChange={(e) => set("apiKey", e.target.value)}
                  placeholder="Paste the API key"
                  required={showCredentials && !isEdit}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="opn-secret">API secret</Label>
                <Input
                  id="opn-secret"
                  type="password"
                  value={form.apiSecret}
                  onChange={(e) => set("apiSecret", e.target.value)}
                  placeholder="Paste the API secret"
                  required={showCredentials && !isEdit}
                />
              </div>
            </>
          )}
          {form.type === "ELASTICSEARCH" && (
            <>
              <Tabs
                value={form.esAuthMode}
                onValueChange={(v) => set("esAuthMode", v as "apiKey" | "basic")}
              >
                <TabsList>
                  <TabsTrigger value="apiKey">API key</TabsTrigger>
                  <TabsTrigger value="basic">Username / password</TabsTrigger>
                </TabsList>
              </Tabs>
              {form.esAuthMode === "apiKey" ? (
                <div className="grid gap-2">
                  <Label htmlFor="es-api-key">API key</Label>
                  <Input
                    id="es-api-key"
                    type="password"
                    value={form.esApiKey}
                    onChange={(e) => set("esApiKey", e.target.value)}
                    placeholder="Paste the encoded API key"
                    required={showCredentials && !isEdit}
                  />
                </div>
              ) : (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="es-username">Username</Label>
                    <Input
                      id="es-username"
                      value={form.esUsername}
                      onChange={(e) => set("esUsername", e.target.value)}
                      required={showCredentials && !isEdit}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="es-password">Password</Label>
                    <Input
                      id="es-password"
                      type="password"
                      value={form.esPassword}
                      onChange={(e) => set("esPassword", e.target.value)}
                      required={showCredentials && !isEdit}
                    />
                  </div>
                </>
              )}
            </>
          )}
          {form.type === "OTX" && (
            <div className="grid gap-2">
              <Label htmlFor="otx-api-key">OTX API key</Label>
              <Input
                id="otx-api-key"
                type="password"
                value={form.otxApiKey}
                onChange={(e) => set("otxApiKey", e.target.value)}
                placeholder="Paste your OTX key"
                required={showCredentials && !isEdit}
              />
            </div>
          )}
          {form.type === "CLOUDFLARE" && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="cloudflare-account-id">Account ID</Label>
                <Input
                  id="cloudflare-account-id"
                  value={form.cloudflareAccountId}
                  onChange={(e) => set("cloudflareAccountId", e.target.value)}
                  placeholder="32-character account ID"
                  autoComplete="off"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Each integration represents one account, so your two accounts remain separate and clearly sourced.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cloudflare-api-token">API token</Label>
                <Input
                  id="cloudflare-api-token"
                  type="password"
                  value={form.cloudflareApiToken}
                  onChange={(e) => set("cloudflareApiToken", e.target.value)}
                  placeholder="Paste the read-only account token"
                  required={showCredentials && !isEdit}
                />
              </div>
            </>
          )}
          {form.type === "TAILSCALE" && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="tailscale-tailnet">Tailnet ID</Label>
                <Input
                  id="tailscale-tailnet"
                  value={form.tailscaleTailnet}
                  onChange={(event) => set("tailscaleTailnet", event.target.value)}
                  placeholder="-"
                  autoComplete="off"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Use <code>-</code> for the token&apos;s default tailnet, or enter its DNS name.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tailscale-access-token">Access token</Label>
                <Input
                  id="tailscale-access-token"
                  type="password"
                  value={form.tailscaleAccessToken}
                  onChange={(event) => set("tailscaleAccessToken", event.target.value)}
                  placeholder="tskey-api-…"
                  autoComplete="new-password"
                  required={showCredentials && !isEdit}
                />
              </div>
            </>
          )}
          {form.type === "CENSYS" && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="censys-access-token">Personal access token</Label>
                <Input
                  id="censys-access-token"
                  type="password"
                  value={form.censysAccessToken}
                  onChange={(event) => set("censysAccessToken", event.target.value)}
                  placeholder="Paste the Censys Platform PAT"
                  autoComplete="new-password"
                  required={showCredentials && !isEdit}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="censys-organization-id">Organization ID (optional)</Label>
                <Input
                  id="censys-organization-id"
                  value={form.censysOrganizationId}
                  onChange={(event) => set("censysOrganizationId", event.target.value)}
                  placeholder="Use the token's default organization"
                  autoComplete="off"
                />
              </div>
            </>
          )}
          {form.type === "SECURITYTRAILS" && (
            <div className="grid gap-2">
              <Label htmlFor="securitytrails-api-key">API key</Label>
              <Input
                id="securitytrails-api-key"
                type="password"
                value={form.securityTrailsApiKey}
                onChange={(event) => set("securityTrailsApiKey", event.target.value)}
                placeholder="Paste the key from Account → Credentials"
                autoComplete="new-password"
                required={showCredentials && !isEdit}
              />
              <p className="text-xs text-muted-foreground">
                Sent only in the <code>APIKEY</code> request header. PolySIEM never places it in a URL.
              </p>
            </div>
          )}
          {form.type === "UNIFI" && (
            <>
              <Tabs
                value={form.unifiAuthMode}
                onValueChange={(value) => set("unifiAuthMode", value as "apiKey" | "localAccount")}
              >
                <TabsList>
                  <TabsTrigger value="apiKey">API key</TabsTrigger>
                  <TabsTrigger value="localAccount">Legacy local account</TabsTrigger>
                </TabsList>
              </Tabs>
              {form.unifiAuthMode === "apiKey" ? (
                <div className="grid gap-2">
                  <Label htmlFor="unifi-api-key">API key</Label>
                  <Input
                    id="unifi-api-key"
                    type="password"
                    value={form.unifiApiKey}
                    onChange={(event) => set("unifiApiKey", event.target.value)}
                    placeholder="Paste the key from Network → Integrations"
                    autoComplete="new-password"
                    required={showCredentials && !isEdit}
                  />
                  <p className="text-xs text-muted-foreground">
                    Sent only in the <code>X-API-KEY</code> request header and stored encrypted.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="unifi-username">Username</Label>
                    <Input
                      id="unifi-username"
                      value={form.unifiUsername}
                      onChange={(event) => set("unifiUsername", event.target.value)}
                      placeholder="polysiem"
                      required={showCredentials && !isEdit}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="unifi-password">Password</Label>
                    <Input
                      id="unifi-password"
                      type="password"
                      value={form.unifiPassword}
                      onChange={(event) => set("unifiPassword", event.target.value)}
                      placeholder="Enter the local account password"
                      autoComplete="new-password"
                      required={showCredentials && !isEdit}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
      
      {form.type === "EDGE_NAT_SERVER" && (
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
              checked={edgeUsesSingleInterface}
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
                placeholder={edgeUsesSingleInterface ? form.edgePublicInterface || "eth0" : "tailscale0"}
                disabled={edgeUsesSingleInterface}
                required
              />
              <p className="text-xs text-muted-foreground">
                {edgeUsesSingleInterface
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
            <Switch
              id="edge-ip-forwarding"
              checked={form.edgeEnableIpForwarding}
              onCheckedChange={(value) => set("edgeEnableIpForwarding", value)}
            />
          </div>
        </div>
      )}
      
      {form.type === "OPNSENSE" && (
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
            <Switch
              id="opn-bandwidth"
              checked={form.bandwidthPolling}
              onCheckedChange={(v) => set("bandwidthPolling", v)}
            />
          </div>
          {form.bandwidthPolling && (
            <div className="grid gap-2">
              <Label htmlFor="opn-bandwidth-interval">Poll interval (minutes)</Label>
              <Input
                id="opn-bandwidth-interval"
                type="number"
                min={1}
                max={60}
                value={form.bandwidthPollMinutes}
                onChange={(e) => set("bandwidthPollMinutes", e.target.value)}
                className="max-w-32"
              />
            </div>
          )}
        </div>
      )}
      
      {form.type === "OTX" && (
        <div className="grid gap-2">
          <Label htmlFor="otx-feed">Pulse feed</Label>
          <Select value={form.otxFeed} onValueChange={(v) => set("otxFeed", v as OtxFeedValue)}>
            <SelectTrigger id="otx-feed" className="max-w-72">
              <SelectValue />
            </SelectTrigger>
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
      )}
      
      {form.type === "CENSYS" && (
        <div className="space-y-4 rounded-md border p-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="censys-ai-limit">Maximum live AI/MCP lookups per rolling 24 hours</Label>
              <span className="min-w-10 rounded-md bg-muted px-2 py-1 text-center text-sm font-medium tabular-nums">
                {form.censysAiDailyCallLimit}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Cache hits are free and always allowed. Set this to 0 to make AI and MCP cache-only; workflow lookups remain cache-first but are not counted in this AI budget.
            </p>
          </div>
          <Slider
            id="censys-ai-limit"
            min={0}
            max={100}
            step={1}
            value={[form.censysAiDailyCallLimit]}
            onValueChange={([value]) => set("censysAiDailyCallLimit", value ?? 0)}
            aria-label="Maximum Censys AI and MCP live lookups per rolling 24 hours"
          />
        </div>
      )}
      
      {form.type === "SECURITYTRAILS" && (
        <div className="space-y-4 rounded-md border p-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="securitytrails-ai-limit">Maximum live AI/MCP lookups per rolling 24 hours</Label>
              <span className="min-w-10 rounded-md bg-muted px-2 py-1 text-center text-sm font-medium tabular-nums">
                {form.securityTrailsAiDailyCallLimit}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Cache hits stay available. Set this to 0 for cache-only AI and MCP access; administrator-run and workflow behavior remains governed separately.
            </p>
          </div>
          <Slider
            id="securitytrails-ai-limit"
            min={0}
            max={100}
            step={1}
            value={[form.securityTrailsAiDailyCallLimit]}
            onValueChange={([value]) => set("securityTrailsAiDailyCallLimit", value ?? 0)}
            aria-label="Maximum SecurityTrails AI and MCP live lookups per rolling 24 hours"
          />
          <div className="flex items-start gap-2 rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
            <span>SecurityTrails documents its API as read-only. This connection cannot change SecurityTrails data.</span>
          </div>
        </div>
      )}
      
      {form.type === "CLOUDFLARE" && (
        <div className="space-y-4 rounded-md border p-3">
          <p className="text-sm font-medium">Configuration evidence</p>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="cloudflare-dns">Include zones and DNS records</Label>
              <p className="text-xs text-muted-foreground">
                Maps proxied records and tunnel CNAMEs to their published hostnames.
              </p>
            </div>
            <Switch
              id="cloudflare-dns"
              checked={form.cloudflareIncludeDns}
              onCheckedChange={(value) => set("cloudflareIncludeDns", value)}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="cloudflare-connections">Include connector status</Label>
              <p className="text-xs text-muted-foreground">
                Shows active tunnel connectors and Cloudflare edge locations when the token permits it.
              </p>
            </div>
            <Switch
              id="cloudflare-connections"
              checked={form.cloudflareIncludeConnections}
              onCheckedChange={(value) => set("cloudflareIncludeConnections", value)}
            />
          </div>
        </div>
      )}
      
      {form.type === "TAILSCALE" && (
        <div className="space-y-4 rounded-md border p-3">
          <p className="text-sm font-medium">Network evidence</p>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="tailscale-routes">Include subnet and exit-node routes</Label>
              <p className="text-xs text-muted-foreground">
                Shows which Tailscale devices advertise or currently provide routes into your other networks.
              </p>
            </div>
            <Switch
              id="tailscale-routes"
              checked={form.tailscaleIncludeRoutes}
              onCheckedChange={(value) => set("tailscaleIncludeRoutes", value)}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="tailscale-dns">Include DNS configuration</Label>
              <p className="text-xs text-muted-foreground">
                Maps MagicDNS, global resolvers, search domains, and restricted split-DNS domains.
              </p>
            </div>
            <Switch
              id="tailscale-dns"
              checked={form.tailscaleIncludeDns}
              onCheckedChange={(value) => set("tailscaleIncludeDns", value)}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="tailscale-policy">Include access policy</Label>
              <p className="text-xs text-muted-foreground">
                Reads grants, ACLs, named hosts, app connectors, services, and route auto-approvers.
              </p>
            </div>
            <Switch
              id="tailscale-policy"
              checked={form.tailscaleIncludePolicy}
              onCheckedChange={(value) => set("tailscaleIncludePolicy", value)}
            />
          </div>
        </div>
      )}
      
      {form.type === "UNIFI" && (
        <div className="grid gap-2">
          <Label htmlFor="unifi-site">Site</Label>
          <Input
            id="unifi-site"
            value={form.unifiSite}
            onChange={(e) => set("unifiSite", e.target.value)}
            placeholder="default"
            className="max-w-48"
          />
          <p className="text-xs text-muted-foreground">
            Match the site name, internal reference, or UUID. <code>default</code> also selects the only site.
          </p>
        </div>
      )}
      
      {form.type === "ELASTICSEARCH" && (
        <div className="space-y-4 rounded-md border p-3">
          <p className="text-sm font-medium">Log query settings</p>
          <div className="grid gap-2">
            <Label htmlFor="es-index">Index pattern</Label>
            <Input
              id="es-index"
              value={form.indexPattern}
              onChange={(e) => set("indexPattern", e.target.value)}
              placeholder={ES_SETTINGS_DEFAULTS.indexPattern}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="es-ts">Timestamp field</Label>
              <Input
                id="es-ts"
                value={form.timestampField}
                onChange={(e) => set("timestampField", e.target.value)}
                placeholder={ES_SETTINGS_DEFAULTS.timestampField}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="es-level">Level field</Label>
              <Input
                id="es-level"
                value={form.levelField}
                onChange={(e) => set("levelField", e.target.value)}
                placeholder={ES_SETTINGS_DEFAULTS.levelField}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="es-message">Message field</Label>
              <Input
                id="es-message"
                value={form.messageField}
                onChange={(e) => set("messageField", e.target.value)}
                placeholder={ES_SETTINGS_DEFAULTS.messageField}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="es-host">Host field</Label>
              <Input
                id="es-host"
                value={form.hostField}
                onChange={(e) => set("hostField", e.target.value)}
                placeholder={ES_SETTINGS_DEFAULTS.hostField}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
