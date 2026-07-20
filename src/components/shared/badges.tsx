import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EntityStatusValue, PowerStateValue, SourceValue, SyncStatusValue } from "@/lib/types";

/** Where an entity came from: manual entry or an integration sync. */
export function SourceBadge({ source, className }: { source: SourceValue; className?: string }) {
  const styles: Record<SourceValue, string> = {
    MANUAL: "border-border bg-muted text-muted-foreground",
    PROXMOX: "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
    OPNSENSE: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    UNIFI: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
    CLOUDFLARE: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
    TAILSCALE: "border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    EDGE_NAT_SERVER: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  };
  const labels: Record<SourceValue, string> = {
    MANUAL: "Manual",
    PROXMOX: "Proxmox",
    OPNSENSE: "OPNsense",
    UNIFI: "UniFi",
    CLOUDFLARE: "Cloudflare",
    TAILSCALE: "Tailscale",
    EDGE_NAT_SERVER: "Edge NAT",
  };
  return (
    <Badge variant="outline" className={cn(styles[source], className)}>
      {labels[source]}
    </Badge>
  );
}

/** Sync lifecycle status of an entity. ACTIVE renders nothing (the default). */
export function StatusBadge({ status, className }: { status: EntityStatusValue; className?: string }) {
  if (status === "ACTIVE") return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        status === "STALE"
          ? "border-warning/40 bg-warning/10 text-warning"
          : "border-destructive/40 bg-destructive/10 text-destructive",
        className,
      )}
    >
      {status === "STALE" ? "Stale" : "Removed"}
    </Badge>
  );
}

/** VM/container power state with a colored dot. */
export function PowerBadge({ state, className }: { state: PowerStateValue; className?: string }) {
  const dot: Record<PowerStateValue, string> = {
    RUNNING: "bg-success",
    STOPPED: "bg-muted-foreground/50",
    PAUSED: "bg-warning",
    UNKNOWN: "bg-muted-foreground/30",
  };
  const label: Record<PowerStateValue, string> = {
    RUNNING: "Running",
    STOPPED: "Stopped",
    PAUSED: "Paused",
    UNKNOWN: "Unknown",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <span className={cn("size-2 rounded-full", dot[state])} />
      {label[state]}
    </span>
  );
}

/** Integration sync run status. */
export function SyncStatusBadge({ status, className }: { status: SyncStatusValue | null; className?: string }) {
  if (!status) {
    return (
      <Badge variant="outline" className={cn("text-muted-foreground", className)}>
        Never synced
      </Badge>
    );
  }
  const styles: Record<SyncStatusValue, string> = {
    RUNNING: "border-info/40 bg-info/10 text-info",
    SUCCESS: "border-success/40 bg-success/10 text-success",
    PARTIAL: "border-warning/40 bg-warning/10 text-warning",
    FAILED: "border-destructive/40 bg-destructive/10 text-destructive",
  };
  const labels: Record<SyncStatusValue, string> = {
    RUNNING: "Syncing…",
    SUCCESS: "Healthy",
    PARTIAL: "Partial",
    FAILED: "Failed",
  };
  return (
    <Badge variant="outline" className={cn(styles[status], className)}>
      {labels[status]}
    </Badge>
  );
}
