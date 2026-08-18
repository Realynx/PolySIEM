"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  CircleCheck,
  Clipboard,
  Loader2,
  Radio,
  ShieldAlert,
  Terminal,
  TriangleAlert,
  Waypoints,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { copyText } from "@/components/shared/clipboard";
import { CopyButton } from "@/components/ssh/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  connectorAgentSummary,
  connectorInstallProgress,
  connectorLastContactAt,
  connectorStatusPresentation,
  type ConnectorDto,
  type ConnectorInstallReason,
  type ConnectorInstallReveal,
  type ConnectorInstallState,
} from "./edge-networks-types";

export interface ConnectorInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The one-time token + ready-to-paste command, straight from the API. */
  reveal: ConnectorInstallReveal;
  /** Why the token exists: a brand-new connector, or a re-issued one. */
  reason: ConnectorInstallReason;
  /** The connector as returned when the token was minted (never changes). */
  connector: ConnectorDto;
  /** Freshest row from the polling connectors list; drives the live status. */
  liveConnector?: ConnectorDto;
  serverName: string;
  /** e.g. "23.94.251.183:51820/udp" — where the connector must reach outbound. */
  edgeEndpointLabel: string;
}

/**
 * The centerpiece install flow, modelled on Cloudflare's connector install UX:
 * numbered steps, one copy-paste command, an explicit once-only token warning,
 * and a live status that flips to "connected" while the operator watches.
 *
 * Mount with `key={reveal.installToken}` so a re-issued token resets the
 * baseline used to detect the re-enrollment.
 */
export function ConnectorInstallDialog({
  open,
  onOpenChange,
  reveal,
  reason,
  connector,
  liveConnector,
  serverName,
  edgeEndpointLabel,
}: ConnectorInstallDialogProps) {
  const current = liveConnector ?? connector;
  // Captured once per mount: after a rotate the connector is usually already
  // "connected" on its old token, so success needs a fresh check-in.
  const [baselineLastSeenAt] = useState<string | null>(connector.lastSeenAt);
  const [celebrated, setCelebrated] = useState(false);
  const progress = connectorInstallProgress({ connector: liveConnector, reason, baselineLastSeenAt });
  const connected = progress.state === "connected";
  const status = connectorStatusPresentation(current);
  const agentSummary = connectorAgentSummary(current);
  const contactAt = connectorLastContactAt(current);

  useEffect(() => {
    if (!open || !connected || celebrated) return;
    setCelebrated(true);
    toast.success(reason === "created" ? `${connector.name} is connected` : `${connector.name} re-enrolled with the new token`);
  }, [open, connected, celebrated, reason, connector.name]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {reason === "created" ? "Install connector" : "New install token"}
            <span className="text-muted-foreground">—</span>
            {connector.name}
          </DialogTitle>
          <DialogDescription>
            {reason === "created"
              ? `The connector dials out to ${serverName} and holds the tunnel open, so this machine publishes services without a public IP or an inbound port.`
              : `Re-run the installer on the machine to move ${connector.name} onto this token. The previous token stops working immediately.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/5 p-3">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium">This token is shown only once</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              PolySIEM keeps only a hash of it. Copy the command now — if it is lost, issue a new one with
              <span className="font-medium text-foreground"> Rotate token</span> rather than trying to recover this one.
            </p>
          </div>
        </div>

        <div className="space-y-5">
          <InstallStep number="1" title="Open a root shell on the machine inside your network">
            <p className="text-sm text-muted-foreground">
              Any Linux host that can already reach the service you want to publish. It needs outbound access to{" "}
              <code className="font-mono text-xs">{edgeEndpointLabel}</code> — nothing has to be opened inbound.
            </p>
          </InstallStep>

          <InstallStep number="2" title="Paste this one-liner">
            <p className="text-sm text-muted-foreground">
              It installs <code className="font-mono text-xs">wireguard-tools</code> and the PolySIEM connector agent,
              enrolls this machine with the token above, and starts a service that keeps the tunnel up across reboots.
            </p>
            <InstallCommandBlock command={reveal.installCommand} />
            <p className="text-xs text-muted-foreground">
              The agent generates its own WireGuard key on the machine. The private half never leaves the host and is
              never sent to PolySIEM.
            </p>
          </InstallStep>

          <InstallStep number="3" title="Watch it come online">
            <div
              className={cn(
                "rounded-lg border p-3 transition-colors",
                connected && "border-success/40 bg-success/5",
                progress.state === "stale" && "border-warning/40 bg-warning/5",
                progress.state === "disabled" && "border-dashed",
              )}
              aria-live="polite"
            >
              <div className="flex items-start gap-2.5">
                <StatusGlyph state={progress.state} />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm font-medium", connected && "text-success")}>{progress.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{progress.detail}</p>
                </div>
                <Badge variant={status.variant} className={cn("font-normal", status.tone === "warning" && "text-warning")}>
                  {status.tone === "success" && <span className="size-1.5 rounded-full bg-success" />}
                  {status.label}
                </Badge>
              </div>

              {connected && (
                <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-3">
                  <InstallFact label="Tunnel address" value={current.tunnelAddress} mono />
                  <InstallFact label="Latest contact" value={contactAt ? formatRelative(contactAt) : "just now"} />
                  <InstallFact label="Reported agent" value={agentSummary ?? "Not reported"} />
                </div>
              )}
            </div>
            {!connected && (
              <p className="text-xs text-muted-foreground">
                Status refreshes every few seconds. You can close this dialog — the connector finishes enrolling on its
                own, and the list on the server card keeps updating.
              </p>
            )}
          </InstallStep>
        </div>

        <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
          <div>
            <p className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">Connector ID</p>
            <div className="flex items-center gap-1">
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{connector.connectorId}</code>
              <CopyButton value={connector.connectorId} label="Copy connector ID" />
            </div>
          </div>
          <div>
            <p className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">Tunnel address</p>
            <p className="flex flex-wrap items-baseline gap-1.5">
              <code className="font-mono text-xs">{current.tunnelAddress}</code>
              <span className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
                <Waypoints className="size-3" aria-hidden="true" /> assigned automatically
              </span>
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant={connected ? "default" : "outline"}>
              {connected ? <Check /> : null}
              {connected ? "Done" : "Close"}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusGlyph({ state }: { state: ConnectorInstallState }) {
  if (state === "connected") return <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />;
  if (state === "stale") return <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />;
  if (state === "disabled") return <Radio className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  return <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />;
}

/** The copy-paste centerpiece: prominent, monospace, one obvious copy action. */
function InstallCommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await copyText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard unavailable — copy manually");
    }
  };
  return (
    <div className="overflow-hidden rounded-lg border border-primary/30 bg-muted">
      <div className="flex items-center justify-between gap-2 border-b border-primary/20 bg-primary/[0.06] px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <Terminal className="size-3.5 text-primary" aria-hidden="true" /> Run as root
        </span>
        <Button type="button" variant="ghost" size="sm" className="h-7" onClick={copy}>
          {copied ? <Check className="text-success" /> : <Clipboard />}
          {copied ? "Copied" : "Copy command"}
        </Button>
      </div>
      <pre className="max-h-40 overflow-auto p-3 text-xs leading-relaxed">
        <code className="break-all whitespace-pre-wrap">{command}</code>
      </pre>
    </div>
  );
}

function InstallStep({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 sm:grid-cols-[2rem_1fr]">
      <div className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
        {number}
      </div>
      <div className="min-w-0 space-y-3">
        <h3 className="font-medium">{title}</h3>
        {children}
      </div>
    </section>
  );
}

function InstallFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 truncate font-medium", mono && "font-mono text-xs")}>{value}</p>
    </div>
  );
}
