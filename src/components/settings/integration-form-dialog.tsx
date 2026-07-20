"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Cloud,
  ExternalLink,
  Rss,
  Router,
  Radar,
  ScanSearch,
  ScrollText,
  Server,
  Share2,
  Shield,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  buildMockIntegrationUrl,
  DEFAULT_MOCK_SCENARIO_PROFILE,
  DEFAULT_MOCK_SCENARIO_SEED,
  MAX_MOCK_SCENARIO_SEED_LENGTH,
  MOCK_SCENARIO_PROFILES,
  normalizeMockScenarioSeed,
  parseMockIntegrationUrl,
  type MockScenarioProfile,
} from "@/lib/integrations/mock-url";
import { isLiveQueryType, type IntegrationTypeValue, type OtxFeedValue } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch } from "@/components/shared/api-client";
import { getElasticsearchEndpointIssue } from "@/lib/integrations/elasticsearch/endpoint";
import type { IntegrationView } from "./integrations-manager";
import { securityTrailsAiDailyLimit } from "./securitytrails-presentation";

const ES_SETTINGS_DEFAULTS = {
  indexPattern: "logs-*",
  timestampField: "@timestamp",
  levelField: "log.level",
  messageField: "message",
  hostField: "host.name",
};

interface FormState {
  type: IntegrationTypeValue;
  name: string;
  baseUrl: string;
  verifyTls: boolean;
  syncIntervalMinutes: string;
  mockProfile: MockScenarioProfile;
  mockSeed: string;
  // Proxmox
  tokenId: string;
  tokenSecret: string;
  // OPNsense
  apiKey: string;
  apiSecret: string;
  bandwidthPolling: boolean;
  bandwidthPollMinutes: string;
  // Elasticsearch
  esAuthMode: "apiKey" | "basic";
  esApiKey: string;
  esUsername: string;
  esPassword: string;
  indexPattern: string;
  timestampField: string;
  levelField: string;
  messageField: string;
  hostField: string;
  // UniFi
  unifiAuthMode: "apiKey" | "localAccount";
  unifiApiKey: string;
  unifiUsername: string;
  unifiPassword: string;
  unifiSite: string;
  // AlienVault OTX
  otxApiKey: string;
  otxFeed: OtxFeedValue;
  // Cloudflare
  cloudflareApiToken: string;
  cloudflareAccountId: string;
  cloudflareIncludeDns: boolean;
  cloudflareIncludeConnections: boolean;
  // Tailscale
  tailscaleAccessToken: string;
  tailscaleTailnet: string;
  tailscaleIncludeRoutes: boolean;
  tailscaleIncludeDns: boolean;
  tailscaleIncludePolicy: boolean;
  // Censys
  censysAccessToken: string;
  censysOrganizationId: string;
  censysAiDailyCallLimit: number;
  // SecurityTrails
  securityTrailsApiKey: string;
  securityTrailsAiDailyCallLimit: number;
  // Edge NAT Server
  edgePublicInterface: string;
  edgeOutboundInterface: string;
  edgeEnableIpForwarding: boolean;
}

function emptyForm(integration: IntegrationView | null): FormState {
  const es = { ...ES_SETTINGS_DEFAULTS, ...(integration?.settings ?? {}) };
  const unifiSite = (integration?.settings?.site as string | undefined) ?? "default";
  const mock = integration ? parseMockIntegrationUrl(integration.baseUrl) : null;
  return {
    type: integration?.type ?? "PROXMOX",
    name: integration?.name ?? "",
    baseUrl: integration?.baseUrl ?? "",
    verifyTls: integration?.verifyTls ?? true,
    syncIntervalMinutes: String(integration?.syncIntervalMinutes ?? 15),
    mockProfile: mock?.profile ?? DEFAULT_MOCK_SCENARIO_PROFILE,
    mockSeed: mock?.seed ?? DEFAULT_MOCK_SCENARIO_SEED,
    tokenId: "",
    tokenSecret: "",
    apiKey: "",
    apiSecret: "",
    bandwidthPolling: (integration?.settings?.bandwidthPolling as boolean | undefined) ?? false,
    bandwidthPollMinutes: String(integration?.settings?.bandwidthPollMinutes ?? 2),
    esAuthMode: "apiKey",
    esApiKey: "",
    esUsername: "",
    esPassword: "",
    indexPattern: es.indexPattern,
    timestampField: es.timestampField,
    levelField: es.levelField,
    messageField: es.messageField,
    hostField: es.hostField,
    unifiAuthMode: "apiKey",
    unifiApiKey: "",
    unifiUsername: "",
    unifiPassword: "",
    unifiSite,
    otxApiKey: "",
    otxFeed: (integration?.settings?.feed as OtxFeedValue | undefined) ?? "activity",
    cloudflareApiToken: "",
    cloudflareAccountId: (integration?.settings?.accountId as string | undefined) ?? "",
    cloudflareIncludeDns: (integration?.settings?.includeDnsRecords as boolean | undefined) ?? true,
    cloudflareIncludeConnections:
      (integration?.settings?.includeTunnelConnections as boolean | undefined) ?? true,
    tailscaleAccessToken: "",
    tailscaleTailnet: (integration?.settings?.tailnet as string | undefined) ?? "-",
    tailscaleIncludeRoutes: (integration?.settings?.includeRoutes as boolean | undefined) ?? true,
    tailscaleIncludeDns: (integration?.settings?.includeDns as boolean | undefined) ?? true,
    tailscaleIncludePolicy: (integration?.settings?.includePolicy as boolean | undefined) ?? true,
    censysAccessToken: "",
    censysOrganizationId: (integration?.settings?.organizationId as string | undefined) ?? "",
    censysAiDailyCallLimit: (integration?.settings?.aiDailyCallLimit as number | undefined) ?? 10,
    securityTrailsApiKey: "",
    securityTrailsAiDailyCallLimit: securityTrailsAiDailyLimit(integration?.settings),
    edgePublicInterface: (integration?.settings?.publicInterface as string | undefined) ?? "eth0",
    edgeOutboundInterface: (integration?.settings?.outboundInterface as string | undefined) ?? "tailscale0",
    edgeEnableIpForwarding: (integration?.settings?.enableIpForwarding as boolean | undefined) ?? true,
  };
}

function formForType(type: IntegrationTypeValue | null): FormState {
  const next = emptyForm(null);
  if (!type) return next;
  next.type = type;
  if (type === "OTX") next.baseUrl = "https://otx.alienvault.com";
  if (type === "CLOUDFLARE") next.baseUrl = "https://api.cloudflare.com/client/v4";
  if (type === "TAILSCALE") next.baseUrl = "https://api.tailscale.com/api/v2";
  if (type === "EDGE_NAT_SERVER") next.baseUrl = "ssh://";
  if (type === "CENSYS") next.baseUrl = "https://api.platform.censys.io/v3";
  if (type === "SECURITYTRAILS") next.baseUrl = "https://api.securitytrails.com/v1";
  return next;
}

function buildCredentials(form: FormState): Record<string, string> {
  switch (form.type) {
    case "PROXMOX":
      return { tokenId: form.tokenId, tokenSecret: form.tokenSecret };
    case "OPNSENSE":
      return { apiKey: form.apiKey, apiSecret: form.apiSecret };
    case "ELASTICSEARCH":
      return form.esAuthMode === "apiKey"
        ? { apiKey: form.esApiKey }
        : { username: form.esUsername, password: form.esPassword };
    case "UNIFI":
      return form.unifiAuthMode === "apiKey"
        ? { apiKey: form.unifiApiKey }
        : { username: form.unifiUsername, password: form.unifiPassword };
    case "OTX":
      return { apiKey: form.otxApiKey };
    case "CLOUDFLARE":
      return { apiToken: form.cloudflareApiToken };
    case "TAILSCALE":
      return { accessToken: form.tailscaleAccessToken };
    case "CENSYS":
      return { accessToken: form.censysAccessToken };
    case "SECURITYTRAILS":
      return { apiKey: form.securityTrailsApiKey };
    case "EDGE_NAT_SERVER":
      return { username: "polysiem-edge" };
  }
}

/**
 * Per-type walkthrough for creating least-privilege credentials on the target
 * system. Steps verified against Proxmox VE 8/9, OPNsense 26.1 and
 * Elasticsearch 9.
 */
const SETUP_GUIDES: Record<IntegrationTypeValue, { title: string; intro: string; steps: ReactNode[] }> = {
  PROXMOX: {
    title: "Create a read-only token (about 2 minutes)",
    intro: "This creates one dedicated read-only account for your whole cluster. You can remove it at any time.",
    steps: [
      <span key="shell">
        In Proxmox, select any cluster node and open <strong>Shell</strong>.
      </span>,
      <div key="cmd" className="min-w-0 space-y-1.5">
        <span>Run these three commands:</span>
        <CommandBlock
          lines={[
            'pveum user add polysiem@pve --comment "PolySIEM read-only sync"',
            "pveum acl modify / --users polysiem@pve --roles PVEAuditor",
            "pveum user token add polysiem@pve sync --privsep 0",
          ]}
        />
      </div>,
      <span key="token">
        Copy the secret from the final command—it is shown only once. Then paste token ID{" "}
        <code className="rounded bg-muted px-1">polysiem@pve!sync</code> and the secret below.
      </span>,
    ],
  },
  OPNSENSE: {
    title: "Create a limited API key (about 3 minutes)",
    intro: "Create a dedicated user for PolySIEM so you can revoke access without affecting your own login.",
    steps: [
      <span key="user">
        Go to <strong>System → Access → Users</strong> and add a user (e.g.{" "}
        <code className="rounded bg-muted px-1">polysiem</code>) with a random password.
      </span>,
      <span key="privs">
        Grant these privileges: <strong>Lobby: Dashboard</strong>, <strong>Status: Interfaces</strong>,{" "}
        <strong>Firewall: Rules [new]</strong>, <strong>Firewall: Aliases</strong>, and the settings page of
        your DHCP service (e.g. <strong>Services: Dnsmasq DNS/DHCP: Settings</strong>, ISC DHCPv4 or Kea).
      </span>,
      <span key="key">
        In the user&apos;s <strong>API keys</strong> section press <strong>+</strong> — a key/secret pair
        downloads as a text file. Paste both here. The base URL is your firewall&apos;s web UI address, e.g.{" "}
        <code className="rounded bg-muted px-1">https://10.0.1.1</code>.
      </span>,
    ],
  },
  ELASTICSEARCH: {
    title: "Create a read-only API key (about 2 minutes)",
    intro: "Limit the key to the log indices you want PolySIEM to search. It cannot update or delete documents.",
    steps: [
      <span key="open">
        In Kibana, open <strong>Dev Tools</strong>.
      </span>,
      <div key="cmd" className="min-w-0 space-y-1.5">
        <span>Run this request, changing the index names if needed:</span>
        <CommandBlock
          lines={[
            "POST /_security/api_key",
            `{"name": "polysiem", "role_descriptors": {"polysiem_read": {`,
            `  "cluster": ["monitor"],`,
            `  "indices": [{"names": ["logs-*", "filebeat-*"],`,
            `    "privileges": ["read", "view_index_metadata", "monitor"]}]}}}`,
          ]}
        />
      </div>,
      <span key="use">
        Use the <code className="rounded bg-muted px-1">encoded</code> value from the response as the API key,
        and match the index pattern below to the names you granted. The base URL is{" "}
        <code className="rounded bg-muted px-1">https://&lt;es-host&gt;:9200</code>.
      </span>,
    ],
  },
  OTX: {
    title: "Get a free OTX API key (about 2 minutes)",
    intro: "AlienVault OTX is a free community threat-intelligence feed. No infrastructure changes are required.",
    steps: [
      <span key="signup">
        Create a free account at{" "}
        <a href="https://otx.alienvault.com" target="_blank" rel="noreferrer" className="text-primary hover:underline">
          otx.alienvault.com
        </a>
        . New accounts automatically follow the AlienVault team, so the feed starts populated.
      </span>,
      <span key="key">
        Open{" "}
        <a
          href="https://otx.alienvault.com/api"
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          otx.alienvault.com/api
        </a>{" "}
        and copy your <strong>OTX Key</strong> into the field below. The base URL is{" "}
        <code className="rounded bg-muted px-1">https://otx.alienvault.com</code>.
      </span>,
      <span key="subs">
        Subscribe to more pulses or authors on OTX to grow the feed — PolySIEM shows whatever your account
        subscribes to.
      </span>,
    ],
  },
  CLOUDFLARE: {
    title: "Create a read-only API token (about 3 minutes)",
    intro: "Connect one Cloudflare account per integration so routes and zones from separate accounts keep clear provenance.",
    steps: [
      <span key="token">
        In Cloudflare open <strong>My Profile → API Tokens → Create Token</strong>, find the premade{" "}
        <strong>Read All Resources</strong> template, and choose <strong>Use template</strong>.
      </span>,
      <span key="permissions">
        Keep the template&apos;s read-only policies and scope its account and zone resources to what you want PolySIEM to document. It grants read access without granting write access.
      </span>,
      <span key="route-management">
        If you also want to manage published hostnames from <strong>Network → Edge Networks</strong>, create a custom token scoped to the same account with <strong>Cloudflare Tunnel Edit</strong>, plus <strong>Zone Read</strong> and <strong>DNS Edit</strong> on the selected zones. Keep using Read All Resources if you only want discovery.
      </span>,
      <span key="account">
        Copy the token and the 32-character <strong>Account ID</strong> from the account overview. Add your other Cloudflare account as a second integration with its own token and account ID.
      </span>,
    ],
  },
  TAILSCALE: {
    title: "Create a Tailscale API access token (about 2 minutes)",
    intro: "PolySIEM only makes read requests, collecting inventory, DNS, routes, connectivity, and policy without changing the tailnet.",
    steps: [
      <span key="open">
        In the Tailscale admin console, open <strong>Settings → Keys</strong>, then choose{" "}
        <strong>Generate access token</strong>.
      </span>,
      <span key="expiry">
        Choose an expiry between 1 and 90 days, generate the token, and copy it now. Tailscale only shows
        the full token once, and PolySIEM stores it encrypted. Tailscale access tokens are broadly
        privileged, so use a dedicated short-lived token and rotate it before expiry.
      </span>,
      <span key="tailnet">
        Leave the tailnet ID as <code className="rounded bg-muted px-1">-</code> to use the token&apos;s
        default tailnet, or enter the tailnet DNS name shown in <strong>DNS → Tailnet name</strong>.
      </span>,
    ],
  },
  CENSYS: {
    title: "Create a Censys Platform API token (about 2 minutes)",
    intro: "PolySIEM uses Censys host lookups only when the AI, MCP, or a workflow asks for a public IP. Responses are cached for four days.",
    steps: [
      <span key="token">Sign in to Censys Platform, open your account API settings, and create a personal access token (PAT).</span>,
      <span key="copy">Copy the token into PolySIEM. It is stored encrypted and is never shown again.</span>,
      <span key="org">If the token belongs to more than one organization, enter the Organization ID to bill and scope requests to that organization. Otherwise leave it blank.</span>,
      <span key="budget">Choose a rolling 24-hour AI/MCP live-call limit below. Cache hits do not count against it.</span>,
    ],
  },
  SECURITYTRAILS: {
    title: "Create a SecurityTrails API key (about 2 minutes)",
    intro: "SecurityTrails is read-only. PolySIEM uses its DNS, domain, IP, and WHOIS evidence when an AI, MCP, or workflow lookup needs outside context.",
    steps: [
      <span key="open">
        Sign in to SecurityTrails and open{" "}
        <a href="https://securitytrails.com/app/account/credentials" target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
          Account → Credentials <ExternalLink className="inline size-3" />
        </a>.
      </span>,
      <span key="create">
        Choose <strong>Create New API Key</strong>, give it a recognizable note such as{" "}
        <code className="rounded bg-muted px-1">PolySIEM</code>, then create it.
      </span>,
      <span key="copy">
        Copy the API key and paste it below. PolySIEM stores it encrypted and sends it only in the HTTPS{" "}
        <code className="rounded bg-muted px-1">APIKEY</code> header—never in a URL or query string.
      </span>,
      <span key="budget">
        Set the rolling 24-hour AI/MCP live-call limit below. Cached answers remain available without consuming another live-call allowance.
      </span>,
    ],
  },
  EDGE_NAT_SERVER: {
    title: "A restricted key is created for you",
    intro: "PolySIEM generates a dedicated Ed25519 key after you save this connection. The private half stays encrypted inside PolySIEM.",
    steps: [
      <span key="create">Enter the remote server&apos;s SSH address and the two interfaces PolySIEM should manage.</span>,
      <span key="install">After saving, open <strong>Network → Edge networks</strong> and copy the generated installer to the server. It creates a non-root <code>polysiem-edge</code> account with a forced, NAT-only command.</span>,
      <span key="verify">Compare the scanned SSH host-key fingerprint with the server console before you trust it. PolySIEM refuses future connections if that identity changes.</span>,
    ],
  },
  UNIFI: {
    title: "Create a local Network API key (about 2 minutes)",
    intro: "The official API works on UniFi OS Server and UniFi console hardware, and keeps the credential separate from an admin password.",
    steps: [
      <span key="integration">
        In UniFi Network open <strong>Settings → Control Plane → Integrations</strong> and create an API key
        named <code className="rounded bg-muted px-1">PolySIEM</code>.
      </span>,
      <span key="key">
        Copy the key when it is shown and paste it below. PolySIEM sends it only in the{" "}
        <code className="rounded bg-muted px-1">X-API-KEY</code> header.
      </span>,
      <span key="url">
        Use the local UniFi OS or console address, including its port, but not the{" "}
        <code className="rounded bg-muted px-1">/unifi-api/network</code> documentation path. Leave the site as{" "}
        <code className="rounded bg-muted px-1">default</code> for a single-site installation.
      </span>,
    ],
  },
};

function CommandBlock({ lines }: { lines: string[] }) {
  return (
    <pre className="max-w-full overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs leading-relaxed whitespace-pre">
      {lines.join("\n")}
    </pre>
  );
}

function SetupGuide({ type }: { type: IntegrationTypeValue }) {
  const [open, setOpen] = useState(false);
  const guide = SETUP_GUIDES[type];
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-auto w-full justify-between gap-2 px-3 py-2.5 text-left text-xs"
        >
          {guide.title}
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 min-w-0 space-y-2 overflow-hidden rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          <p>{guide.intro}</p>
          <ol className="list-decimal space-y-2 pl-4">
            {guide.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

const INTEGRATION_FORM_META: Record<
  IntegrationTypeValue,
  {
    label: string;
    description: string;
    summaryTitle: string;
    summary: string;
    namePlaceholder: string;
    urlLabel: string;
    urlPlaceholder: string;
    urlHint: string;
    credentialsTitle: string;
    credentialsHint: string;
    icon: typeof Server;
  }
> = {
  PROXMOX: {
    label: "Proxmox VE",
    description: "Connect the whole cluster through any one node. Your token is encrypted, and PolySIEM never needs your root password.",
    summaryTitle: "A safe, read-only start",
    summary: "You only need a node address and one API token. PolySIEM discovers the rest of the cluster automatically and cannot change your VMs or containers.",
    namePlaceholder: "e.g. Home Proxmox cluster",
    urlLabel: "Proxmox address",
    urlPlaceholder: "https://192.168.1.10:8006",
    urlHint: "Use any cluster node, including port 8006. PolySIEM will discover the other nodes.",
    credentialsTitle: "Read-only API token",
    credentialsHint: "Already have a PVEAuditor token? Paste it below. PolySIEM stores the secret encrypted.",
    icon: Server,
  },
  OPNSENSE: {
    label: "OPNsense",
    description: "Import networks, firewall rules, and DHCP data with a dedicated, limited API user.",
    summaryTitle: "Limited access by design",
    summary: "PolySIEM only needs permission to read the pages it syncs. It does not need firmware, update, or administrator access.",
    namePlaceholder: "e.g. Main firewall",
    urlLabel: "OPNsense address",
    urlPlaceholder: "https://192.168.1.1",
    urlHint: "Use the same address you open for the OPNsense web interface.",
    credentialsTitle: "Limited API key",
    credentialsHint: "Paste the key and secret downloaded by OPNsense. Both are stored encrypted.",
    icon: Shield,
  },
  ELASTICSEARCH: {
    label: "Elasticsearch",
    description: "Search and visualize your logs with a key restricted to the indices you choose.",
    summaryTitle: "Only the logs you choose",
    summary: "A read-only API key is recommended. PolySIEM searches matching indices but cannot edit or delete their documents.",
    namePlaceholder: "e.g. Lab logs",
    urlLabel: "Elasticsearch address",
    urlPlaceholder: "https://elasticsearch.example.com:9200",
    urlHint: "Enter the HTTP endpoint PolySIEM can reach, usually on port 9200.",
    credentialsTitle: "Read-only credentials",
    credentialsHint: "An API key is the simplest option. Credentials are stored encrypted.",
    icon: ScrollText,
  },
  UNIFI: {
    label: "UniFi",
    description: "Document sites, networks, clients, gateways, switches, WiFi broadcasts, and access points through the local API. AP-only sites are supported; a UniFi gateway is not required.",
    summaryTitle: "One API across UniFi hosts",
    summary: "The local Network API works with self-hosted UniFi OS Server, AP-only sites, and UniFi gateway hardware. Legacy controller login remains available as a fallback.",
    namePlaceholder: "e.g. Home WiFi",
    urlLabel: "UniFi host address",
    urlPlaceholder: "https://192.168.1.20:11443",
    urlHint: "Use the local UniFi OS Server or console address, including its port. Do not include the API documentation path.",
    credentialsTitle: "UniFi Network credentials",
    credentialsHint: "API key is recommended. A classic local account is supported for older Network Server installations.",
    icon: Wifi,
  },
  OTX: {
    label: "AlienVault OTX",
    description: "Add a free community threat-intelligence feed with a personal API key.",
    summaryTitle: "A free, read-only feed",
    summary: "There is nothing to install on your network. PolySIEM only reads the OTX pulses your account follows.",
    namePlaceholder: "e.g. Community threat feed",
    urlLabel: "OTX address",
    urlPlaceholder: "https://otx.alienvault.com",
    urlHint: "The standard OTX address is already filled in for you.",
    credentialsTitle: "OTX API key",
    credentialsHint: "Paste the key from your OTX API page. PolySIEM stores it encrypted.",
    icon: Rss,
  },
  CLOUDFLARE: {
    label: "Cloudflare",
    description: "Document zones, proxied DNS, published tunnel applications, connectors, and private routes from one Cloudflare account.",
    summaryTitle: "One read-only account at a time",
    summary: "PolySIEM reads Cloudflare configuration and topology only. Add another integration for a second account; neither token needs write access.",
    namePlaceholder: "e.g. Personal Cloudflare",
    urlLabel: "Cloudflare API address",
    urlPlaceholder: "https://api.cloudflare.com/client/v4",
    urlHint: "Use Cloudflare's standard API address unless you intentionally proxy it.",
    credentialsTitle: "Read All Resources API token",
    credentialsHint: "Use the premade Read All Resources token for discovery. Edge Networks route management additionally requires Cloudflare Tunnel Edit, Zone Read, and DNS Edit.",
    icon: Cloud,
  },
  TAILSCALE: {
    label: "Tailscale",
    description: "Match devices and overlay IPs, then map DNS, access policy, subnet routes, and app-connector entry points.",
    summaryTitle: "One device, one shared identity",
    summary: "PolySIEM matches Tailscale machines to hosts, VMs, and containers already found by other integrations. Unmatched devices are added without hiding their Tailscale provenance.",
    namePlaceholder: "e.g. Home tailnet",
    urlLabel: "Tailscale API address",
    urlPlaceholder: "https://api.tailscale.com/api/v2",
    urlHint: "Use Tailscale's standard API address.",
    credentialsTitle: "Tailscale API access token",
    credentialsHint: "Use a dedicated, short-lived access token from the Tailscale Keys page. PolySIEM encrypts it at rest and only sends GET requests.",
    icon: Share2,
  },
  CENSYS: {
    label: "Censys",
    description: "Enrich public IPs with internet-facing services, DNS names, network ownership, and location evidence.",
    summaryTitle: "Credit-aware enrichment",
    summary: "AI, MCP, and workflows share one four-day response cache. A rolling AI/MCP limit prevents unexpected credit use while cached answers stay available.",
    namePlaceholder: "e.g. Censys host intelligence",
    urlLabel: "Censys Platform API address",
    urlPlaceholder: "https://api.platform.censys.io/v3",
    urlHint: "PolySIEM only sends your PAT to the official Censys Platform v3 API.",
    credentialsTitle: "Censys personal access token",
    credentialsHint: "Create a Platform API PAT. PolySIEM tests it using the credit-balance endpoint, which does not spend lookup credits.",
    icon: ScanSearch,
  },
  SECURITYTRAILS: {
    label: "SecurityTrails",
    description: "Enrich domains and public IPs with current and historical DNS, WHOIS, associated records, and ownership evidence.",
    summaryTitle: "Read-only investigation context",
    summary: "PolySIEM shares cached SecurityTrails answers across AI, MCP, and workflows. An administrator-controlled rolling limit caps live AI/MCP cache misses.",
    namePlaceholder: "e.g. SecurityTrails domain intelligence",
    urlLabel: "SecurityTrails API address",
    urlPlaceholder: "https://api.securitytrails.com/v1",
    urlHint: "PolySIEM only sends the encrypted key to the official SecurityTrails API over HTTPS.",
    credentialsTitle: "SecurityTrails API key",
    credentialsHint: "Create a dedicated key from Account → Credentials. The API is read-only, and PolySIEM authenticates with the APIKEY header.",
    icon: Radar,
  },
  EDGE_NAT_SERVER: {
    label: "Edge NAT Server",
    description: "Publish selected lab services through a small remote server, while keeping your home WAN address out of packet-level port forwards.",
    summaryTitle: "A narrow management path",
    summary: "PolySIEM generates a dedicated SSH key, pins the server identity, and installs a forced-command account that can manage only PolySIEM-owned NAT chains—not a general root shell.",
    namePlaceholder: "e.g. New York edge gateway",
    urlLabel: "Edge server SSH address",
    urlPlaceholder: "ssh://edge.example.com:22",
    urlHint: "Use an address reachable from PolySIEM. The SSH user is fixed to the restricted polysiem-edge service account.",
    credentialsTitle: "Generated SSH key",
    credentialsHint: "There is nothing to paste. PolySIEM creates the key after you save the integration.",
    icon: Router,
  },
};

function IntegrationPicker({
  onSelect,
  onCancel,
}: {
  onSelect: (type: IntegrationTypeValue) => void;
  onCancel: () => void;
}) {
  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle>Add an integration</DialogTitle>
        <DialogDescription>
          Choose a service to connect. You will get a short, tailored setup guide next.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 py-2 sm:grid-cols-2 lg:grid-cols-3">
        {(Object.entries(INTEGRATION_FORM_META) as [IntegrationTypeValue, (typeof INTEGRATION_FORM_META)[IntegrationTypeValue]][]).map(
          ([type, meta]) => {
            const Icon = meta.icon;
            return (
              <button
                key={type}
                type="button"
                className="group flex min-h-40 flex-col items-start rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 transition hover:bg-primary/5 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onSelect(type)}
              >
                <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <span className="mt-4 font-heading text-sm font-medium">{meta.label}</span>
                <span className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">
                  {meta.description}
                </span>
                <span className="mt-3 flex items-center gap-1 text-xs font-medium text-primary">
                  Connect <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>
            );
          },
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      </DialogFooter>
    </>
  );
}

function credentialsFilled(form: FormState): boolean {
  switch (form.type) {
    case "PROXMOX":
      return Boolean(form.tokenId.trim() && form.tokenSecret.trim());
    case "OPNSENSE":
      return Boolean(form.apiKey.trim() && form.apiSecret.trim());
    case "ELASTICSEARCH":
      return form.esAuthMode === "apiKey"
        ? Boolean(form.esApiKey.trim())
        : Boolean(form.esUsername.trim() && form.esPassword);
    case "UNIFI":
      return form.unifiAuthMode === "apiKey"
        ? Boolean(form.unifiApiKey.trim())
        : Boolean(form.unifiUsername.trim() && form.unifiPassword);
    case "OTX":
      return Boolean(form.otxApiKey.trim());
    case "CLOUDFLARE":
      return Boolean(form.cloudflareApiToken.trim() && form.cloudflareAccountId.trim());
    case "TAILSCALE":
      return Boolean(form.tailscaleAccessToken.trim() && form.tailscaleTailnet.trim());
    case "CENSYS":
      return Boolean(form.censysAccessToken.trim());
    case "SECURITYTRAILS":
      return Boolean(form.securityTrailsApiKey.trim());
    case "EDGE_NAT_SERVER":
      return true;
  }
}

export function IntegrationFormDialog({
  open,
  onOpenChange,
  integration,
  mockIntegrationsEnabled,
  initialType = null,
  credentialUpgrade = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integration: IntegrationView | null;
  mockIntegrationsEnabled: boolean;
  initialType?: IntegrationTypeValue | null;
  credentialUpgrade?: "cloudflare-routes" | null;
}) {
  const router = useRouter();
  const isEdit = integration !== null;
  const [form, setForm] = useState<FormState>(() => emptyForm(integration));
  const [replaceCredentials, setReplaceCredentials] = useState(false);
  const [selectingType, setSelectingType] = useState(integration === null && initialType === null);
  const usingMock = form.baseUrl.trim().toLowerCase().startsWith("mock://");
  const elasticsearchEndpointIssue =
    form.type === "ELASTICSEARCH" && !usingMock
      ? getElasticsearchEndpointIssue(form.baseUrl)
      : null;
  const formMeta = INTEGRATION_FORM_META[form.type];
  const originalUsesMock =
    integration?.baseUrl.trim().toLowerCase().startsWith("mock://") === true;
  const changingMockToLive = isEdit && originalUsesMock && !usingMock;

  // Re-seed the form whenever the dialog opens for a (different) target.
  useEffect(() => {
    if (open) {
      setForm(integration ? emptyForm(integration) : formForType(initialType));
      setReplaceCredentials(credentialUpgrade === "cloudflare-routes" && integration?.type === "CLOUDFLARE");
      setSelectingType(integration === null && initialType === null);
    }
  }, [open, integration, initialType, credentialUpgrade]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setMockOptions(profile: MockScenarioProfile, seed: string) {
    const rawSeed = seed.slice(0, MAX_MOCK_SCENARIO_SEED_LENGTH);
    setForm((current) => ({
      ...current,
      mockProfile: profile,
      mockSeed: rawSeed,
      baseUrl: buildMockIntegrationUrl(profile, rawSeed),
    }));
  }

  const save = useMutation({
    mutationFn: () => {
      const interval = Number.parseInt(form.syncIntervalMinutes, 10);
      const common = {
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        verifyTls: form.verifyTls,
        syncIntervalMinutes: Number.isFinite(interval) ? interval : 15,
      };
      const esSettings = {
        indexPattern: form.indexPattern.trim() || ES_SETTINGS_DEFAULTS.indexPattern,
        timestampField: form.timestampField.trim() || ES_SETTINGS_DEFAULTS.timestampField,
        levelField: form.levelField.trim(),
        messageField: form.messageField.trim(),
        hostField: form.hostField.trim(),
      };

      const unifiSettings = { site: form.unifiSite.trim() || "default" };

      const pollMinutes = Number.parseInt(form.bandwidthPollMinutes, 10);
      const opnSettings = {
        bandwidthPolling: form.bandwidthPolling,
        bandwidthPollMinutes: Number.isFinite(pollMinutes) ? Math.min(60, Math.max(1, pollMinutes)) : 2,
      };

      const otxSettings = { feed: form.otxFeed };
      const cloudflareSettings = {
        accountId: form.cloudflareAccountId.trim(),
        includeDnsRecords: form.cloudflareIncludeDns,
        includeTunnelConnections: form.cloudflareIncludeConnections,
      };
      const tailscaleSettings = {
        tailnet: form.tailscaleTailnet.trim() || "-",
        includeRoutes: form.tailscaleIncludeRoutes,
        includeDns: form.tailscaleIncludeDns,
        includePolicy: form.tailscaleIncludePolicy,
      };
      const edgeNatSettings = {
        publicInterface: form.edgePublicInterface.trim() || "eth0",
        outboundInterface: form.edgeOutboundInterface.trim() || "tailscale0",
        enableIpForwarding: form.edgeEnableIpForwarding,
      };
      const censysSettings = {
        organizationId: form.censysOrganizationId.trim(),
        aiDailyCallLimit: form.censysAiDailyCallLimit,
      };
      const securityTrailsSettings = {
        aiDailyCallLimit: form.securityTrailsAiDailyCallLimit,
      };

      if (isEdit) {
        const body: Record<string, unknown> = { ...common };
        if (form.type === "ELASTICSEARCH") body.settings = esSettings;
        if (form.type === "UNIFI") body.settings = unifiSettings;
        if (form.type === "OPNSENSE") body.settings = opnSettings;
        if (form.type === "OTX") body.settings = otxSettings;
        if (form.type === "CLOUDFLARE") body.settings = cloudflareSettings;
        if (form.type === "TAILSCALE") body.settings = tailscaleSettings;
        if (form.type === "EDGE_NAT_SERVER") body.settings = edgeNatSettings;
        if (form.type === "CENSYS") body.settings = censysSettings;
        if (form.type === "SECURITYTRAILS") body.settings = securityTrailsSettings;
        if ((replaceCredentials || changingMockToLive) && credentialsFilled(form)) {
          body.credentials = buildCredentials(form);
        }
        return apiFetch(`/api/admin/integrations/${integration.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }

      const body: Record<string, unknown> = {
        type: form.type,
        ...common,
        credentials: usingMock ? {} : buildCredentials(form),
      };
      if (form.type === "ELASTICSEARCH") body.settings = esSettings;
      if (form.type === "UNIFI") body.settings = unifiSettings;
      if (form.type === "OPNSENSE") body.settings = opnSettings;
      if (form.type === "OTX") body.settings = otxSettings;
      if (form.type === "CLOUDFLARE") body.settings = cloudflareSettings;
      if (form.type === "TAILSCALE") body.settings = tailscaleSettings;
      if (form.type === "EDGE_NAT_SERVER") body.settings = edgeNatSettings;
      if (form.type === "CENSYS") body.settings = censysSettings;
      if (form.type === "SECURITYTRAILS") body.settings = securityTrailsSettings;
      return apiFetch("/api/admin/integrations", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast.success(isEdit ? `Updated ${form.name}` : `Added ${form.name}`);
      onOpenChange(false);
      if (!isEdit && form.type === "EDGE_NAT_SERVER") {
        router.push("/network/edge-networks");
      } else {
        router.refresh();
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (elasticsearchEndpointIssue) {
      toast.error(elasticsearchEndpointIssue);
      return;
    }
    if ((!isEdit || changingMockToLive) && !usingMock && !credentialsFilled(form)) {
      toast.error("Please fill in the credentials");
      return;
    }
    save.mutate();
  }

  const showCredentials =
    (!isEdit || replaceCredentials || changingMockToLive) && !usingMock && form.type !== "EDGE_NAT_SERVER";

  function selectIntegration(type: IntegrationTypeValue) {
    setForm(formForType(type));
    setSelectingType(false);
  }

  if (!isEdit && selectingType) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100svh-1rem)] overflow-y-auto sm:max-h-[90svh] sm:max-w-3xl">
          <IntegrationPicker
            onSelect={selectIntegration}
            onCancel={() => onOpenChange(false)}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100svh-1rem)] flex-col overflow-hidden sm:max-h-[90svh] sm:max-w-2xl">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <DialogHeader className="shrink-0 pr-8">
            {!isEdit && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 mb-1 w-fit text-muted-foreground"
                onClick={() => setSelectingType(true)}
              >
                <ArrowLeft /> All integrations
              </Button>
            )}
            <DialogTitle>
              {isEdit
                ? `Edit ${integration.name}`
                : `Connect ${formMeta.label}`}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update connection details. Credentials stay unchanged unless you replace them."
                : formMeta.description}
            </DialogDescription>
          </DialogHeader>

          <div className="-mr-2 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain py-4 pr-2">
            {!isEdit && !usingMock && (
              <div className="flex items-start gap-3 rounded-lg bg-primary/5 p-3 ring-1 ring-primary/15">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <ShieldCheck className="size-4" />
                </span>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{formMeta.summaryTitle}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {formMeta.summary}
                  </p>
                </div>
              </div>
            )}

            {isEdit && form.type === "CLOUDFLARE" && credentialUpgrade === "cloudflare-routes" && (
              <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Upgrade this token for published-route management</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    In Cloudflare, either edit the current token or create a Custom Token with
                    <strong> Account → Cloudflare Tunnel → Edit</strong> and
                    <strong> Zone → Zone → Read</strong>, and
                    <strong> Zone → DNS → Edit</strong>, scoped to this account and the zones PolySIEM may publish.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" asChild>
                    <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">
                      Open Cloudflare API Tokens <ExternalLink />
                    </a>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Editing the existing token normally keeps the stored secret, so you can close this dialog and retry the route. If you create a replacement token, paste it below and save.
                </p>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="int-name">Name</Label>
              <Input
                id="int-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={formMeta.namePlaceholder}
                required
                maxLength={64}
              />
            </div>
            {mockIntegrationsEnabled && form.type !== "CLOUDFLARE" && form.type !== "TAILSCALE" && form.type !== "EDGE_NAT_SERVER" && form.type !== "CENSYS" && form.type !== "SECURITYTRAILS" && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-dashed p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="int-mock">Use generated mock data</Label>
                  <p className="text-xs text-muted-foreground">
                    Runs completely offline and does not contact a remote system or require credentials.
                  </p>
                </div>
                <Switch
                  id="int-mock"
                  checked={usingMock}
                  onCheckedChange={(enabled) => {
                    if (enabled) {
                      setForm((current) => ({
                        ...current,
                        baseUrl: buildMockIntegrationUrl(
                          current.mockProfile,
                          current.mockSeed,
                        ),
                        verifyTls: false,
                      }));
                    } else {
                      set("baseUrl", "");
                    }
                  }}
                />
              </div>
            )}
            {mockIntegrationsEnabled && usingMock && (
              <div className="space-y-4 rounded-md border border-dashed p-3">
                <div className="grid gap-2">
                  <Label htmlFor="int-mock-profile">Scenario profile</Label>
                  <Select
                    value={form.mockProfile}
                    onValueChange={(value) =>
                      setMockOptions(value as MockScenarioProfile, form.mockSeed)
                    }
                  >
                    <SelectTrigger id="int-mock-profile">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(MOCK_SCENARIO_PROFILES).map(([value, profile]) => (
                        <SelectItem key={value} value={value}>
                          {profile.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {MOCK_SCENARIO_PROFILES[form.mockProfile].description}
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="int-mock-seed">Stable seed</Label>
                  <Input
                    id="int-mock-seed"
                    value={form.mockSeed}
                    maxLength={MAX_MOCK_SCENARIO_SEED_LENGTH}
                    onChange={(event) =>
                      setMockOptions(form.mockProfile, event.target.value)
                    }
                    onBlur={() =>
                      setMockOptions(
                        form.mockProfile,
                        normalizeMockScenarioSeed(form.mockSeed),
                      )
                    }
                    placeholder={DEFAULT_MOCK_SCENARIO_SEED}
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Reusing the same profile and seed produces the same inventory and event identities. Use
                    the pair across related mock integrations to keep one coherent lab.
                  </p>
                </div>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="int-url">{formMeta.urlLabel}</Label>
              <Input
                id="int-url"
                value={form.baseUrl}
                onChange={(e) => set("baseUrl", e.target.value)}
                placeholder={formMeta.urlPlaceholder}
                required
                disabled={mockIntegrationsEnabled && usingMock}
              />
              {!usingMock && (
                <p className="text-xs text-muted-foreground">
                  {formMeta.urlHint}
                </p>
              )}
              {elasticsearchEndpointIssue && (
                <p className="text-xs text-destructive">
                  {elasticsearchEndpointIssue}
                </p>
              )}
              {usingMock && mockIntegrationsEnabled && (
                <p className="text-xs text-muted-foreground">
                  This saved integration uses the offline mock driver.
                </p>
              )}
              {usingMock && !mockIntegrationsEnabled && (
                <p className="text-xs text-destructive">
                  Mock integrations are turned off, so this one can no longer be saved as-is. Point it
                  at a real system, or delete it from the integrations list.
                </p>
              )}
            </div>
            {form.type !== "EDGE_NAT_SERVER" && <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="int-tls">Verify TLS certificate</Label>
                <p className="text-xs text-muted-foreground">
                  {form.type === "PROXMOX"
                    ? "Turn this off if the node still uses Proxmox's default self-signed certificate."
                    : "Turn this off only if the service uses a self-signed certificate."}
                </p>
              </div>
              <Switch
                id="int-tls"
                checked={form.verifyTls}
                disabled={usingMock}
                onCheckedChange={(v) => set("verifyTls", v)}
              />
            </div>}
            {!isLiveQueryType(form.type) && (
              <div className="grid gap-2">
                <Label htmlFor="int-interval">Sync interval (minutes)</Label>
                <Input
                  id="int-interval"
                  type="number"
                  min={1}
                  max={1440}
                  value={form.syncIntervalMinutes}
                  onChange={(e) => set("syncIntervalMinutes", e.target.value)}
                  className="max-w-32"
                />
              </div>
            )}

            {isEdit && form.type !== "EDGE_NAT_SERVER" && (
              <Collapsible open={replaceCredentials} onOpenChange={setReplaceCredentials}>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5">
                    Replace credentials
                    <ChevronDown
                      className={cn("size-4 transition-transform", replaceCredentials && "rotate-180")}
                    />
                  </Button>
                </CollapsibleTrigger>
              </Collapsible>
            )}

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
                  <p className="text-sm font-medium">NAT boundary</p>
                  <p className="text-xs text-muted-foreground">
                    These interface names are allowlisted in the generated helper. You can change them later before applying rules.
                  </p>
                </div>
                {!isEdit && <SetupGuide type="EDGE_NAT_SERVER" />}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="edge-public-interface">Public interface</Label>
                    <Input
                      id="edge-public-interface"
                      value={form.edgePublicInterface}
                      onChange={(event) => set("edgePublicInterface", event.target.value)}
                      placeholder="eth0"
                      required
                    />
                    <p className="text-xs text-muted-foreground">Receives internet traffic on the edge server.</p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edge-outbound-interface">Private-path interface</Label>
                    <Input
                      id="edge-outbound-interface"
                      value={form.edgeOutboundInterface}
                      onChange={(event) => set("edgeOutboundInterface", event.target.value)}
                      placeholder="tailscale0"
                      required
                    />
                    <p className="text-xs text-muted-foreground">Usually <code>tailscale0</code>, or another tunnel toward the lab.</p>
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
          </div>

          <DialogFooter className="relative z-10 shrink-0 bg-popover/95 backdrop-blur supports-backdrop-filter:bg-popover/85">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : isEdit ? "Save changes" : "Add integration"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
