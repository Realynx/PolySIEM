"use client";

import type { ReactNode } from "react";
import { Check, Router, Server, Share2, Terminal, Waypoints } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { copyText } from "@/components/shared/clipboard";
import { CopyButton } from "@/components/ssh/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  connectorContactFallback,
  connectorInstallReachabilityCopy,
  connectorKindPresentation,
  connectorLastContactAt,
  connectorSshPresentation,
  connectorStatusPresentation,
  connectorTunnelProvisionedCopy,
  edgeTunnelSetupNotice,
  type ConnectorDto,
  type ConnectorInstallCommandView,
  type ConnectorKind,
  type ConnectorTunnelProvisionedDto,
  type EdgeNatServer,
} from "@/components/network/edge-networks-types";

/**
 * Small shared pieces of the phone edge-network surface — connector badges, the
 * tap-to-copy row, and the numbered install cards. They are used by the lists,
 * the detail sheets, both setup flows and the edge card's sync details, so they
 * live here instead of in whichever file happened to need them first.
 */

/**
 * Status badge. The shared presentation is kind-aware — manual kinds report
 * pending → configured → disabled instead of the agent's install/heartbeat
 * story — so both presentations say the same words.
 */
export function ConnectorStatusBadge({ connector }: { connector: ConnectorDto }) {
  const view = connectorStatusPresentation(connector);
  return (
    <Badge
      variant={view.variant}
      className={cn("text-[10px] font-normal", view.tone === "warning" && "text-warning")}
    >
      {view.tone === "success" && <span className="size-1.5 rounded-full bg-success" />}
      {view.label}
    </Badge>
  );
}

/** Which kind of far end this is — shown on every row and detail sheet. */
export function ConnectorKindBadge({ kind }: { kind: ConnectorKind }) {
  return (
    <Badge variant="outline" className="text-[10px] font-normal">
      {connectorKindPresentation(kind).label}
    </Badge>
  );
}

/** Icon per kind, matching the picker cards. */
export function connectorKindIcon(kind: ConnectorKind) {
  if (kind === "opnsense") return <Router className="size-4" />;
  if (kind === "peer") return <Share2 className="size-4" />;
  return <Server className="size-4" />;
}

/** Relative handshake/heartbeat line for a row or detail sheet. */
export function contactLabel(connector: ConnectorDto): string {
  const at = connectorLastContactAt(connector);
  return at ? formatRelative(at) : connectorContactFallback(connector);
}

/** Fingerprints and hashes are long; phones get a middle-elided, still-checkable form. */
export function elide(value: string | null | undefined, fallback: string): string {
  if (!value || value === "-") return fallback;
  return value.length > 28 ? `${value.slice(0, 16)}…${value.slice(-8)}` : value;
}

/** "polysiem-connector@10.0.3.42:22", or a plain "not configured" line. */
export function sshEndpointLabel(connector: ConnectorDto): string {
  const ssh = connectorSshPresentation(connector);
  return ssh.endpoint ? `${ssh.username}@${ssh.endpoint}` : "Not configured";
}

/** Full-width tap-to-copy value row — phones have no hover affordance. */
export function MobileCopyRow({
  label,
  value,
  display,
}: {
  label: string;
  /** What lands on the clipboard — always the full value. */
  value: string;
  /** Shortened stand-in for a value too long to read on a phone, e.g. a hash. */
  display?: string;
}) {
  const copy = async () => {
    try {
      await copyText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Clipboard unavailable — copy manually");
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="flex min-h-13 w-full items-center gap-2 rounded-xl border bg-card px-3 py-2 text-left transition-colors active:bg-muted/70"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] tracking-wide text-muted-foreground uppercase">{label}</span>
        <span className="block truncate font-mono text-xs">{display ?? value}</span>
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">Tap to copy</span>
    </button>
  );
}

/** One end of the two-ended install: a numbered card that can read as satisfied. */
export function InstallEnd({
  index,
  heading,
  title,
  detail,
  satisfied,
  children,
}: {
  index: string;
  heading: string;
  title: string;
  detail: string;
  satisfied: boolean;
  children?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-3",
        satisfied ? "border-success/30 bg-success/5" : "bg-card",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-medium",
            satisfied ? "bg-success text-background" : "bg-primary text-primary-foreground",
          )}
        >
          {satisfied ? <Check className="size-3.5" /> : index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[10px] tracking-wider text-muted-foreground uppercase">{heading}</span>
          <span className="mt-0.5 block text-sm leading-tight font-medium">{title}</span>
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{detail}</span>
        </span>
      </div>
      {children}
    </section>
  );
}

/** Copy-ready command block sized for a phone: scrolls, selects, one copy action. */
export function CommandBlock({
  label,
  command,
  highlight = false,
  copyLabel,
}: {
  label: string;
  command: string;
  highlight?: boolean;
  /** Overrides the derived "Copy <label>" accessible name. */
  copyLabel?: string;
}) {
  return (
    <div className={cn("rounded-xl border bg-muted/40 p-3", highlight && "border-primary/40")}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">{label}</p>
        <CopyButton value={command} label={copyLabel ?? `Copy ${label}`} />
      </div>
      <p className="mt-1 max-h-40 overflow-y-auto break-all font-mono text-xs select-all">{command}</p>
    </div>
  );
}

/**
 * The install one-liner, both variants, on a phone.
 *
 * PolySIEM serves HTTPS with a self-signed certificate by default, so the plain
 * `curl … | sudo sh` dies on certificate verification on a default install.
 * WHICH command leads, what the note says and when the other one is worth
 * offering are all decided by `connectorInstallCommandView` in the shared
 * layer — desktop renders the same decisions — so this component only chooses
 * the phone treatment: full-width copy, scrolling blocks, footnote type.
 */
export function ConnectorInstallCommands({ view }: { view: ConnectorInstallCommandView | null }) {
  const copyPrimary = async () => {
    if (!view) return;
    try {
      await copyText(view.primary);
      toast.success("Install command copied");
    } catch {
      toast.error("Clipboard unavailable — copy manually");
    }
  };
  if (!view) {
    return (
      <p className="rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
        This response carried no install command. Rotate the token to mint a new one.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <CommandBlock label="Run as root on the connector" command={view.primary} highlight />
      <Button type="button" className="w-full" onClick={copyPrimary}>
        <Terminal /> Copy install command
      </Button>
      {view.primaryNote && <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">{view.primaryNote}</p>}
      {view.alternate && (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed p-2.5">
          <p className="text-[11px] leading-snug text-muted-foreground">{view.alternate.label}</p>
          <CommandBlock
            label="Alternative command"
            command={view.alternate.command}
            copyLabel={view.alternate.copyLabel}
          />
        </div>
      )}
      <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">
        {connectorInstallReachabilityCopy(view.origin)}
      </p>
    </div>
  );
}

/**
 * PolySIEM provisions an edge's WireGuard tunnel when a connector is linked to
 * it, so the operator is told it happened rather than discovering it. Neutral
 * tone: this is PolySIEM doing the work, not a fault — the only action left is
 * the apply that pushes it to the host.
 */
export function TunnelProvisionedNote({ tunnel }: { tunnel: ConnectorTunnelProvisionedDto | null | undefined }) {
  if (!tunnel) return null;
  const copy = connectorTunnelProvisionedCopy(tunnel);
  return (
    <p className="flex items-start gap-1.5 rounded-xl border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
      <Waypoints className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">
        <span className="block font-medium">{copy.title}</span>
        <span className="mt-0.5 block leading-snug">{copy.detail}</span>
      </span>
    </p>
  );
}

/**
 * Said BEFORE linking: this edge has no usable tunnel yet, and linking stands
 * one up. The sentence — including which subnet it may promise — comes from the
 * shared layer so the phone and the desktop dialog say the same thing.
 */
export function EdgeTunnelSetupNote({
  server,
  servers = [],
}: {
  server: EdgeNatServer | null | undefined;
  /** Every edge box, so the note never promises a subnet another edge occupies. */
  servers?: readonly EdgeNatServer[];
}) {
  const notice = edgeTunnelSetupNotice(server, servers);
  if (!notice) return null;
  return <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">{notice}</p>;
}

export function InstallStep({ index, children }: { index: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-medium">
        {index}
      </span>
      <span className="text-muted-foreground">{children}</span>
    </li>
  );
}
