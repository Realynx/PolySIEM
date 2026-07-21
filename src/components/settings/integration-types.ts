import {
  Cloud,
  Radar,
  Router,
  Rss,
  ScanSearch,
  ScrollText,
  Server,
  Share2,
  Shield,
  Wifi,
} from "lucide-react";
import type { IntegrationTypeValue, SyncStatusValue } from "@/lib/types";

export interface IntegrationView {
  id: string;
  type: IntegrationTypeValue;
  name: string;
  enabled: boolean;
  baseUrl: string;
  verifyTls: boolean;
  syncIntervalMinutes: number;
  settings: Record<string, unknown> | null;
  lastSyncAt: string | null;
  lastSyncStatus: SyncStatusValue | null;
  lastSyncError: string | null;
  hasCredentials?: boolean;
}

export interface DeveloperModeView {
  enabled: boolean;
  features: { mockIntegrations: boolean };
}

export const INTEGRATION_TYPE_META: Record<
  IntegrationTypeValue,
  { label: string; icon: typeof Server; tone: string; iconTone: string }
> = {
  PROXMOX: { label: "Proxmox VE", icon: Server, tone: "from-orange-500/12 to-orange-500/[0.02]", iconTone: "bg-orange-500/12 text-orange-600 dark:text-orange-300" },
  OPNSENSE: { label: "OPNsense", icon: Shield, tone: "from-amber-500/12 to-amber-500/[0.02]", iconTone: "bg-amber-500/12 text-amber-600 dark:text-amber-300" },
  ELASTICSEARCH: { label: "Elasticsearch", icon: ScrollText, tone: "from-violet-500/12 to-violet-500/[0.02]", iconTone: "bg-violet-500/12 text-violet-600 dark:text-violet-300" },
  UNIFI: { label: "UniFi", icon: Wifi, tone: "from-sky-500/12 to-sky-500/[0.02]", iconTone: "bg-sky-500/12 text-sky-600 dark:text-sky-300" },
  OTX: { label: "AlienVault OTX", icon: Rss, tone: "from-rose-500/12 to-rose-500/[0.02]", iconTone: "bg-rose-500/12 text-rose-600 dark:text-rose-300" },
  CLOUDFLARE: { label: "Cloudflare", icon: Cloud, tone: "from-orange-500/12 to-amber-500/[0.02]", iconTone: "bg-orange-500/12 text-orange-600 dark:text-orange-300" },
  TAILSCALE: { label: "Tailscale", icon: Share2, tone: "from-indigo-500/12 to-indigo-500/[0.02]", iconTone: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-300" },
  EDGE_NAT_SERVER: { label: "Edge NAT Server", icon: Router, tone: "from-emerald-500/12 to-emerald-500/[0.02]", iconTone: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" },
  CENSYS: { label: "Censys", icon: ScanSearch, tone: "from-cyan-500/12 to-cyan-500/[0.02]", iconTone: "bg-cyan-500/12 text-cyan-600 dark:text-cyan-300" },
  SECURITYTRAILS: { label: "SecurityTrails", icon: Radar, tone: "from-fuchsia-500/12 to-fuchsia-500/[0.02]", iconTone: "bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-300" },
};

