import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { INTEGRATION_FORM_META, SetupGuide } from "../integration-form-presentation";
import type { IntegrationCredentialsFieldsProps, IntegrationFieldSetter } from "./types";
import type { FormState } from "../integration-form-model";

export function IntegrationCredentialsFields({
  form,
  set,
  isEdit,
  showCredentials,
}: IntegrationCredentialsFieldsProps) {
  if (!showCredentials) return null;
  const formMeta = INTEGRATION_FORM_META[form.type];
  const required = showCredentials && !isEdit;

  return (
    <div className="space-y-4 rounded-md border p-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{formMeta.credentialsTitle}</p>
        <p className="text-xs text-muted-foreground">{formMeta.credentialsHint}</p>
      </div>
      <SetupGuide type={form.type} />
      <ProviderCredentialInputs form={form} set={set} required={required} />
    </div>
  );
}

function ProviderCredentialInputs({
  form,
  set,
  required,
}: {
  form: FormState;
  set: IntegrationFieldSetter;
  required: boolean;
}) {
  switch (form.type) {
    case "PROXMOX":
      return (
        <>
          <div className="grid gap-2">
            <Label htmlFor="pve-token-id">API token ID</Label>
            <Input
              id="pve-token-id"
              value={form.tokenId}
              onChange={(event) => set("tokenId", event.target.value)}
              placeholder="polysiem@pve!sync"
              required={required}
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
              onChange={(event) => set("tokenSecret", event.target.value)}
              placeholder="Paste the generated secret"
              required={required}
            />
            <p className="text-xs text-muted-foreground">
              Proxmox shows this secret once when it creates the token.
            </p>
          </div>
        </>
      );
    case "OPNSENSE":
      return (
        <>
          <div className="grid gap-2">
            <Label htmlFor="opn-key">API key</Label>
            <Input
              id="opn-key"
              value={form.apiKey}
              onChange={(event) => set("apiKey", event.target.value)}
              placeholder="Paste the API key"
              required={required}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="opn-secret">API secret</Label>
            <Input
              id="opn-secret"
              type="password"
              value={form.apiSecret}
              onChange={(event) => set("apiSecret", event.target.value)}
              placeholder="Paste the API secret"
              required={required}
            />
          </div>
        </>
      );
    case "ELASTICSEARCH":
      return (
        <>
          <Tabs value={form.esAuthMode} onValueChange={(value) => set("esAuthMode", value as "apiKey" | "basic")}>
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
                onChange={(event) => set("esApiKey", event.target.value)}
                placeholder="Paste the encoded API key"
                required={required}
              />
            </div>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="es-username">Username</Label>
                <Input id="es-username" value={form.esUsername} onChange={(event) => set("esUsername", event.target.value)} required={required} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="es-password">Password</Label>
                <Input id="es-password" type="password" value={form.esPassword} onChange={(event) => set("esPassword", event.target.value)} required={required} />
              </div>
            </>
          )}
        </>
      );
    case "OTX":
      return (
        <div className="grid gap-2">
          <Label htmlFor="otx-api-key">OTX API key</Label>
          <Input id="otx-api-key" type="password" value={form.otxApiKey} onChange={(event) => set("otxApiKey", event.target.value)} placeholder="Paste your OTX key" required={required} />
        </div>
      );
    case "CLOUDFLARE":
      return (
        <>
          <div className="grid gap-2">
            <Label htmlFor="cloudflare-account-id">Account ID</Label>
            <Input id="cloudflare-account-id" value={form.cloudflareAccountId} onChange={(event) => set("cloudflareAccountId", event.target.value)} placeholder="32-character account ID" autoComplete="off" required />
            <p className="text-xs text-muted-foreground">
              Each integration represents one account, so your two accounts remain separate and clearly sourced.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="cloudflare-api-token">API token</Label>
            <Input id="cloudflare-api-token" type="password" value={form.cloudflareApiToken} onChange={(event) => set("cloudflareApiToken", event.target.value)} placeholder="Paste the read-only account token" required={required} />
          </div>
        </>
      );
    case "TAILSCALE":
      return (
        <>
          <div className="grid gap-2">
            <Label htmlFor="tailscale-tailnet">Tailnet ID</Label>
            <Input id="tailscale-tailnet" value={form.tailscaleTailnet} onChange={(event) => set("tailscaleTailnet", event.target.value)} placeholder="-" autoComplete="off" required />
            <p className="text-xs text-muted-foreground">
              Use <code>-</code> for the token&apos;s default tailnet, or enter its DNS name.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tailscale-access-token">Access token</Label>
            <Input id="tailscale-access-token" type="password" value={form.tailscaleAccessToken} onChange={(event) => set("tailscaleAccessToken", event.target.value)} placeholder="tskey-api-…" autoComplete="new-password" required={required} />
          </div>
        </>
      );
    case "CENSYS":
      return (
        <>
          <div className="grid gap-2">
            <Label htmlFor="censys-access-token">Personal access token</Label>
            <Input id="censys-access-token" type="password" value={form.censysAccessToken} onChange={(event) => set("censysAccessToken", event.target.value)} placeholder="Paste the Censys Platform PAT" autoComplete="new-password" required={required} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="censys-organization-id">Organization ID (optional)</Label>
            <Input id="censys-organization-id" value={form.censysOrganizationId} onChange={(event) => set("censysOrganizationId", event.target.value)} placeholder="Use the token's default organization" autoComplete="off" />
          </div>
        </>
      );
    case "SECURITYTRAILS":
      return (
        <div className="grid gap-2">
          <Label htmlFor="securitytrails-api-key">API key</Label>
          <Input id="securitytrails-api-key" type="password" value={form.securityTrailsApiKey} onChange={(event) => set("securityTrailsApiKey", event.target.value)} placeholder="Paste the key from Account → Credentials" autoComplete="new-password" required={required} />
          <p className="text-xs text-muted-foreground">
            Sent only in the <code>APIKEY</code> request header. PolySIEM never places it in a URL.
          </p>
        </div>
      );
    case "UNIFI":
      return (
        <>
          <Tabs value={form.unifiAuthMode} onValueChange={(value) => set("unifiAuthMode", value as "apiKey" | "localAccount")}>
            <TabsList>
              <TabsTrigger value="apiKey">API key</TabsTrigger>
              <TabsTrigger value="localAccount">Legacy local account</TabsTrigger>
            </TabsList>
          </Tabs>
          {form.unifiAuthMode === "apiKey" ? (
            <div className="grid gap-2">
              <Label htmlFor="unifi-api-key">API key</Label>
              <Input id="unifi-api-key" type="password" value={form.unifiApiKey} onChange={(event) => set("unifiApiKey", event.target.value)} placeholder="Paste the key from Network → Integrations" autoComplete="new-password" required={required} />
              <p className="text-xs text-muted-foreground">
                Sent only in the <code>X-API-KEY</code> request header and stored encrypted.
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="unifi-username">Username</Label>
                <Input id="unifi-username" value={form.unifiUsername} onChange={(event) => set("unifiUsername", event.target.value)} placeholder="polysiem" required={required} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="unifi-password">Password</Label>
                <Input id="unifi-password" type="password" value={form.unifiPassword} onChange={(event) => set("unifiPassword", event.target.value)} placeholder="Enter the local account password" autoComplete="new-password" required={required} />
              </div>
            </>
          )}
        </>
      );
    case "EDGE_NAT_SERVER":
      return null;
  }
}
