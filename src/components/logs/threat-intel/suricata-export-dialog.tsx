"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1_200);
      }}
    >
      {copied ? <Check data-icon="inline-start" className="text-success" /> : <Copy data-icon="inline-start" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

interface RulesPreview {
  counts: string | null;
  head: string;
}

/**
 * Export dialog: the ruleset URL Suricata/OPNsense subscribes to, a live
 * preview, and the exact OPNsense setup steps.
 */
export function SuricataExportDialog({
  open,
  onOpenChange,
  integrationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integrationId: string;
}) {
  const [origin, setOrigin] = useState("");
  const [token, setToken] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const preview = useQuery({
    queryKey: ["suricata-rules-preview", integrationId],
    enabled: open,
    queryFn: async (): Promise<RulesPreview> => {
      const res = await fetch(
        `/api/logs/threat-intel/suricata.rules?integrationId=${encodeURIComponent(integrationId)}`,
      );
      if (!res.ok) throw new Error(`Rules endpoint returned ${res.status}`);
      const text = await res.text();
      return {
        counts: res.headers.get("X-PolySIEM-Rules"),
        head: text.split("\n").slice(0, 24).join("\n"),
      };
    },
  });

  const tokenValue = token.trim() || "<ps_token>";
  const rulesUrl = `${origin}/api/logs/threat-intel/suricata.rules?token=${tokenValue}`;

  const opnsenseSnippet = useMemo(
    () =>
      [
        "ssh opnsense 'sh -s' <<'EOF'",
        "cat > /usr/local/opnsense/scripts/suricata/metadata/rules/polysiem.xml <<'XML'",
        '<?xml version="1.0"?>',
        "<ruleset>",
        `    <location url="${origin}/" prefix="polysiem"/>`,
        "    <files>",
        `        <file url="${rulesUrl}"`,
        '              description="PolySIEM OTX threat intel"',
        `              documentation_url="${origin}/logs/threat-intel"`,
        "        >polysiem.otx.rules</file>",
        "    </files>",
        "</ruleset>",
        "XML",
        "EOF",
      ].join("\n"),
    [origin, rulesUrl],
  );

  const stats = preview.data?.counts
    ? Object.fromEntries(preview.data.counts.split(";").map((kv) => kv.split("=")))
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Suricata rules export</DialogTitle>
          <DialogDescription>
            PolySIEM serves your OTX feed as a Suricata ruleset — subscribe OPNsense&apos;s Intrusion
            Detection to it and the sensor alerts on threat-feed IPs and domains directly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-md border p-3">
            <p className="text-sm font-medium">Current ruleset</p>
            {preview.isPending ? (
              <Skeleton className="mt-2 h-24 w-full" />
            ) : preview.isError ? (
              <p className="mt-1 text-sm text-destructive">{preview.error.message}</p>
            ) : (
              <>
                {stats && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {stats.ip} IP rules ({stats.ips} IPs from {stats.pulses} pulses) · {stats.dns} DNS rules
                    ({stats.domains} domains)
                  </p>
                )}
                <pre className="mt-2 max-h-44 overflow-auto rounded bg-muted p-2 font-mono text-[0.7rem] leading-relaxed">
                  {preview.data?.head}
                </pre>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="suricata-token" className="flex items-center gap-1.5">
              <KeyRound className="size-3.5" />
              API token
            </Label>
            <p className="text-xs text-muted-foreground">
              The downloader authenticates with a PolySIEM API token (<strong>read</strong> scope). Create
              one under{" "}
              <Link href="/settings/api-tokens" className="text-primary hover:underline">
                Settings → API tokens
              </Link>{" "}
              and paste it here to fill in the URL — it is never stored on this page.
            </p>
            <Input
              id="suricata-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ps_…"
              className="max-w-md font-mono text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label>Ruleset URL</Label>
            <div className="flex items-center gap-2">
              <Input readOnly value={rulesUrl} className="font-mono text-xs" />
              <CopyButton text={rulesUrl} label="Copy" />
            </div>
            <p className="text-xs text-muted-foreground">
              Use the address OPNsense can reach PolySIEM on (not localhost) if they differ.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Register on OPNsense</Label>
              <CopyButton text={opnsenseSnippet} label="Copy command" />
            </div>
            <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-[0.7rem] leading-relaxed">
              {opnsenseSnippet}
            </pre>
            <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
              <li>Run the command above (uses your SSH access to the firewall).</li>
              <li>
                In OPNsense open <strong>Services → Intrusion Detection → Administration → Download</strong>,
                enable <strong>PolySIEM OTX threat intel</strong>, then <strong>Download &amp; Update Rules</strong>.
              </li>
              <li>
                Under <strong>Settings</strong>, set a daily <strong>rule update schedule</strong> so the feed
                stays fresh.
              </li>
              <li>
                Heads-up: OPNsense firmware upgrades can remove the metadata file — re-run the command if the
                ruleset disappears from the Download tab.
              </li>
            </ol>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
