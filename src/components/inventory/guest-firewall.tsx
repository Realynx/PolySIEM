import Link from "next/link";
import type { ReactNode } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  guestFirewallIssues,
  readGuestFirewallPosture,
  type GuestFirewallIssue,
  type GuestFirewallPosture,
} from "@/lib/security/guest-firewall";

const ISSUE_TONE: Record<GuestFirewallIssue["severity"], string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  high: "border-destructive/40 bg-destructive/10 text-destructive",
  medium: "border-warning/40 bg-warning/10 text-warning",
  low: "border-border bg-muted text-muted-foreground",
  info: "border-border bg-muted text-muted-foreground",
};

function IssueBadge({ issue, suffix }: { issue: GuestFirewallIssue; suffix?: string }) {
  return (
    <Badge variant="outline" className={ISSUE_TONE[issue.severity]} title={issue.description}>
      <ShieldAlert />
      {issue.label}
      {suffix}
    </Badge>
  );
}

/**
 * Proxmox guest-firewall warnings ("IP filter off", "Firewall off", …) for a
 * VM/container row. Renders nothing when the guest is fine or not from Proxmox.
 * `compact` shows only the worst issue plus a "+N" count (list rows).
 */
export function GuestFirewallBadges({
  metadata,
  compact = false,
  className,
}: {
  metadata: unknown;
  compact?: boolean;
  className?: string;
}) {
  const issues = guestFirewallIssues(readGuestFirewallPosture(metadata));
  if (issues.length === 0) return null;
  if (compact) {
    return (
      <span className={cn("inline-flex", className)}>
        <IssueBadge issue={issues[0]} suffix={issues.length > 1 ? ` +${issues.length - 1}` : undefined} />
      </span>
    );
  }
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      {issues.map((issue) => (
        <IssueBadge key={issue.id} issue={issue} />
      ))}
    </span>
  );
}

function onOff(value: boolean | null, onLabel = "On", offLabel = "Off") {
  if (value === null) return <span className="text-muted-foreground">Unknown</span>;
  return (
    <span className={value ? "text-success" : "text-destructive"}>{value ? onLabel : offLabel}</span>
  );
}

function PostureRows({ posture }: { posture: GuestFirewallPosture }) {
  const rows: { label: string; value: ReactNode }[] = [
    { label: "Datacenter firewall", value: onOff(posture.clusterEnabled) },
    { label: "Guest firewall", value: posture.configured ? onOff(posture.enabled) : onOff(null) },
    { label: "IP filter (anti-spoofing)", value: onOff(posture.ipfilter) },
    { label: "MAC filter", value: onOff(posture.macfilter) },
    {
      label: "Outbound policy",
      value: posture.policyOut ?? <span className="text-muted-foreground">Unknown</span>,
    },
  ];
  for (const nic of posture.nics ?? []) {
    rows.push({ label: `${nic.name} firewall=1`, value: onOff(nic.firewall, "Yes", "No") });
  }
  return (
    <dl className="divide-y">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-4 py-1.5 first:pt-0 last:pb-0">
          <dt className="text-sm text-muted-foreground">{row.label}</dt>
          <dd className="text-right text-sm font-medium">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Body of the "Proxmox firewall" card on VM/container detail pages: the
 * synced posture plus plain-language warnings. Null for non-Proxmox guests.
 */
export function GuestFirewallPanel({ metadata }: { metadata: unknown }) {
  const posture = readGuestFirewallPosture(metadata);
  if (!posture) return null;
  const issues = guestFirewallIssues(posture);
  return (
    <div className="space-y-3">
      {issues.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 text-success" />
          Firewall, IP filter and NIC firewall flags look good.
        </p>
      ) : (
        <ul className="space-y-2">
          {issues.map((issue) => (
            <li key={issue.id} className="space-y-1">
              <IssueBadge issue={issue} />
              <p className="text-xs text-muted-foreground">{issue.description}</p>
            </li>
          ))}
        </ul>
      )}
      <PostureRows posture={posture} />
      {issues.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Fix in Proxmox under the guest → Firewall → Options (IP filter needs an ipfilter-net0 IP set for VMs and DHCP
          containers) and tick Firewall on each NIC.{" "}
          <Link href="/security" className="font-medium text-foreground underline-offset-4 hover:underline">
            See security findings
          </Link>
        </p>
      )}
    </div>
  );
}

/** True when the guest has Proxmox firewall posture to show. */
export function hasGuestFirewallPosture(metadata: unknown): boolean {
  return readGuestFirewallPosture(metadata) !== null;
}
