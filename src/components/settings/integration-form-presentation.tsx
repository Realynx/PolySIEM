"use client";

import { useState, type ReactNode } from "react";
import {
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
  Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { IntegrationTypeValue } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
    title: "PolySIEM installs the restricted service for you",
    intro: "PolySIEM generates a dedicated Ed25519 key after you save. Its private half stays encrypted inside PolySIEM.",
    steps: [
      <span key="create">Enter the remote server&apos;s SSH address and traffic path. A one-interface WAN proxy can use the same interface in both directions.</span>,
      <span key="install">After saving, open <strong>Network → Edge networks</strong>. Run one short command while signed in with your existing SSH administrator, then PolySIEM connects and installs the service automatically.</span>,
      <span key="verify">Compare the scanned SSH host-key fingerprint with the server console before installation. PolySIEM removes its temporary admin authorization and keeps only a forced, NAT-only service account.</span>,
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

export function SetupGuide({ type }: { type: IntegrationTypeValue }) {
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

export const INTEGRATION_FORM_META: Record<
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
    urlHint: "Use an address reachable from PolySIEM. You will provide your existing SSH administrator only during setup; it is not saved.",
    credentialsTitle: "Generated SSH key",
    credentialsHint: "There is nothing to paste. PolySIEM creates the key after you save the integration.",
    icon: Router,
  },
};

export function IntegrationPicker({
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
