import {
  BookKey,
  BookOpenCheck,
  Box,
  Cable,
  ChartColumn,
  Container,
  FileText,
  Gauge,
  GitBranch,
  Globe,
  HardDrive,
  History,
  KeyRound,
  LayoutDashboard,
  Monitor,
  Network,
  Radio,
  Router,
  ScrollText,
  Server,
  Shield,
  ShieldAlert,
  Tags,
  Waypoints,
  Wifi,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** Reachable from the command palette but hidden in the sidebar — e.g. a tab
   *  of a page that already has its own sidebar entry. */
  paletteOnly?: boolean;
}

export interface NavGroup {
  title: string | null;
  items: NavItem[];
}

/** Canonical sidebar navigation — the single source of truth for app routes. */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: null,
    items: [
      { title: "Dashboard", href: "/", icon: LayoutDashboard },
      { title: "Network insights", href: "/network/insights", icon: ChartColumn },
      { title: "Documentation", href: "/docs", icon: FileText },
    ],
  },
  {
    title: "Inventory",
    items: [
      { title: "Lab map", href: "/inventory/map", icon: Workflow },
      // Hosts, VMs and containers are tabs of one page; this lands on the first tab.
      { title: "Compute", href: "/inventory/hosts", icon: Server },
      { title: "Virtual machines", href: "/inventory/vms", icon: Monitor, paletteOnly: true },
      { title: "Containers", href: "/inventory/containers", icon: Container, paletteOnly: true },
      { title: "Services", href: "/inventory/services", icon: Box },
      { title: "Storage", href: "/inventory/storage", icon: HardDrive },
    ],
  },
  {
    title: "Network",
    items: [
      { title: "Access map", href: "/network/access-map", icon: Waypoints },
      { title: "Firewall", href: "/firewall", icon: Shield },
      { title: "Edge networks", href: "/network/edge-networks", icon: Router },
      // IP addresses and Clients are tabs of the Networks page; these land on them.
      { title: "Networks", href: "/network", icon: Network },
      { title: "IP addresses", href: "/network/ips", icon: Globe, paletteOnly: true },
      { title: "Clients", href: "/network/dhcp", icon: Radio, paletteOnly: true },
      { title: "Switches", href: "/network/switches", icon: Cable },
      { title: "WiFi", href: "/network/wifi", icon: Wifi },
    ],
  },
  {
    title: "Security",
    items: [
      { title: "Security score", href: "/security", icon: Gauge },
      { title: "Threat center", href: "/logs/threats", icon: ShieldAlert },
      { title: "Research", href: "/security/research", icon: BookOpenCheck },
      { title: "SSH keys", href: "/keys", icon: KeyRound },
      { title: "AI credentials", href: "/credentials", icon: BookKey, adminOnly: true },
    ],
  },
  {
    title: "Automation",
    items: [
      { title: "Workflows", href: "/workflows", icon: GitBranch },
      { title: "Run history", href: "/workflows/runs", icon: History },
    ],
  },
  {
    title: "Logs",
    items: [
      { title: "Log explorer", href: "/logs", icon: ScrollText },
      { title: "Tags", href: "/tags", icon: Tags },
    ],
  },
];

/** Destinations the sidebar actually draws; palette-only entries can't highlight. */
const RAIL_HREFS = NAV_GROUPS.flatMap((group) =>
  group.items.filter((item) => !item.paletteOnly).map((item) => item.href),
);

function coversPath(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Whether a nav item should render as the current page. Exactly one sidebar
 * item is expected to match any given route — see nav.test.ts.
 *
 * A parent covers its detail pages (`/network/<id>` → "Networks"), but never a
 * route another sidebar item owns more specifically: without that, every named
 * subpage would light up its parent as well as itself.
 */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/logs") return pathname === "/logs";
  // "Compute" points at its first tab but owns the VM and container tabs too.
  if (href === "/inventory/hosts") {
    return /^\/inventory\/(hosts|vms|containers)(\/|$)/.test(pathname);
  }
  if (!coversPath(href, pathname)) return false;
  return !RAIL_HREFS.some(
    (other) =>
      other !== href && other.startsWith(`${href}/`) && coversPath(other, pathname),
  );
}
