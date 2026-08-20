"use client";

import { useState } from "react";
import { Check, Clipboard, Terminal } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { copyText } from "@/components/shared/clipboard";
import { Button } from "@/components/ui/button";
import {
  connectorInstallReachabilityCopy,
  type ConnectorInstallAlternate,
  type ConnectorInstallCommandView,
} from "./edge-networks-types";

/**
 * The copy-paste centerpiece: prominent, monospace, one obvious copy action.
 *
 * `subdued` drops the accent so a secondary variant sits clearly below the
 * command an operator is meant to run first.
 */
export function CommandBlock({
  command,
  caption,
  copyLabel,
  subdued = false,
}: {
  command: string;
  caption: string;
  copyLabel: string;
  subdued?: boolean;
}) {
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
    <div className={cn("overflow-hidden rounded-lg border bg-muted", !subdued && "border-primary/30")}>
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-b px-3 py-1.5",
          subdued ? "bg-foreground/[0.03]" : "border-primary/20 bg-primary/[0.06]",
        )}
      >
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <Terminal
            className={cn("size-3.5", subdued ? "text-muted-foreground" : "text-primary")}
            aria-hidden="true"
          />
          {caption}
        </span>
        <Button type="button" variant="ghost" size="sm" className="h-7" onClick={copy} aria-label={copyLabel}>
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

/**
 * The install one-liner, matched to how this instance actually serves TLS.
 *
 * PolySIEM is self-signed by default, so the recommended command usually
 * carries curl's `-k`. That is the expected state for a self-hosted install,
 * not a risk, so the explanation is a quiet line rather than a warning — but the
 * other variant stays one click away and says exactly when to reach for it.
 */
export function ConnectorInstallCommands({ view }: { view: ConnectorInstallCommandView }) {
  return (
    <div className="space-y-2">
      <CommandBlock command={view.primary} caption="Run as root" copyLabel="Copy connector command" />
      {view.primaryNote && <p className="text-xs text-muted-foreground">{view.primaryNote}</p>}
      {view.alternate && <InstallAlternateBlock alternate={view.alternate} />}
      <p className="text-xs text-muted-foreground">{connectorInstallReachabilityCopy(view.origin)}</p>
    </div>
  );
}

/** The variant an operator falls back to, under the condition that sends them here. */
function InstallAlternateBlock({ alternate }: { alternate: ConnectorInstallAlternate }) {
  return (
    <div className="space-y-1.5 pt-1">
      <p className="text-xs text-muted-foreground">{alternate.label}</p>
      <CommandBlock command={alternate.command} caption="Alternative" copyLabel={alternate.copyLabel} subdued />
    </div>
  );
}
