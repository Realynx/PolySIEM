"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, ScanLine, SlidersHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { MobileKeyRow, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import {
  edgeServerState,
  EDGE_NETWORKS_QUERY_KEY,
  type EdgeNatServer,
} from "@/components/network/edge-networks-types";
import {
  edgeSyncFacts,
  type EdgeSyncSummary,
  type EdgeSyncTone,
} from "@/components/network/edge-sync-presentation";
import { MobileCopyRow } from "./mobile-connector-atoms";

/**
 * The one sentence an operator needs about an edge box: is what I configured
 * actually live out there, and is there anything left to push?
 *
 * The words themselves come from `network/edge-sync-presentation`, shared with
 * the desktop panel so both surfaces describe the same state identically. Only
 * the phone's *styling* of that state lives here: which tone earns amber, and
 * which of the shared facts get a tap-to-copy row.
 *
 * Revisions, sha256 rule hashes and host-key fingerprints answer a debugging
 * question, not an operating one, so they live one tap away in the details
 * sheet below instead of at the top of the card.
 */

/** How a shared tone reads on a phone. Amber stays reserved for a real fault. */
type MobileSyncTone = "muted" | "success" | "warning";

const MOBILE_SYNC_TONE: Record<EdgeSyncTone, MobileSyncTone> = {
  synced: "success",
  staged: "muted",
  drifted: "warning",
  unknown: "muted",
  disabled: "muted",
  cleanup: "warning",
};

const SYNC_TONE_TEXT: Record<MobileSyncTone, string> = {
  muted: "text-foreground",
  success: "text-success",
  warning: "text-warning",
};

function syncToneClass(tone: EdgeSyncTone): string {
  return SYNC_TONE_TEXT[MOBILE_SYNC_TONE[tone]];
}

/**
 * The consequence sentence, but only where it describes something wrong.
 *
 * Every shared summary carries a `detail`; banner-ing all of them would put an
 * alert on screen in every state, which is the same as having none. Staged and
 * never-applied are ordinary — the sync row and the Apply button already say
 * it — so only drift and an uncleared disabled edge get the amber block.
 */
export function edgeSyncAlert(summary: EdgeSyncSummary): string | null {
  return MOBILE_SYNC_TONE[summary.tone] === "warning" ? summary.detail : null;
}

/** True while this edge still has rules on it that PolySIEM stopped managing. */
export function edgeNeedsCleanup(summary: EdgeSyncSummary): boolean {
  return summary.tone === "cleanup";
}

/** The sync line as a row: tap it for the revisions and hashes behind it. */
export function EdgeSyncRow({
  summary,
  onOpenDetails,
}: {
  summary: EdgeSyncSummary;
  onOpenDetails: () => void;
}) {
  return (
    <MobileListRow
      onClick={onOpenDetails}
      title={<span className={cn("truncate", syncToneClass(summary.tone))}>{summary.headline}</span>}
      trailing={
        <>
          <span className="text-[11px]">Details</span>
          <ChevronRight className="size-4 text-muted-foreground/50" />
        </>
      }
    />
  );
}

/**
 * Forwarding is a kernel setting Apply turns on, so "Off" before the first
 * apply is normal rather than a fault — say which of the two it is.
 *
 * Mobile-only: the Interfaces tab lets an operator turn the request itself off,
 * a state the shared fact list has no wording for. Kept local rather than
 * pushed onto the desktop module, which does not offer that switch.
 */
export function edgeForwardingLabel(server: EdgeNatServer): string {
  const settings = server.settings ?? {};
  const live = settings.syncedSnapshot?.ipForwarding;
  if (live === true) return "On";
  if (settings.enableIpForwarding !== false) {
    return live === false ? "Off on the edge — Apply turns it on" : "On after the next apply";
  }
  return "Off (not requested)";
}

/**
 * Mobile-only: enrollment is driven from the desktop, so the shared module only
 * exposes the pinned fingerprint. The phone still has to say whether that key
 * is trusted, since the setup flow is not reachable from here.
 */
export function edgeHostKeyLabel(server: EdgeNatServer): string {
  const verified = server.hostKeyEnrolled || server.settings?.hostKeyVerified;
  if (!verified) return "Enrollment required";
  return edgeServerState(server) === "online" ? "Pinned and verified" : "Pinned; verify connection";
}

function relativeOr(value: string | null | undefined, fallback: string): string {
  return value ? formatRelative(value) : fallback;
}

/**
 * The one shared fact the phone words better: desktop only distinguishes "on"
 * from "on after the next apply", while the Interfaces tab here has to explain
 * a forwarding switch the operator can turn off.
 */
const SHARED_FORWARDING_FACT = "IP forwarding on the edge";

/** Tier 4: everything the sync line summarises, for when something looks wrong. */
export function EdgeDetailsSheet({
  server,
  summary,
  onOpenChange,
}: {
  server: EdgeNatServer;
  summary: EdgeSyncSummary;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = server.settings ?? {};
  const facts = edgeSyncFacts(server);
  // A fact with a `copy` is a hash or fingerprint: too long to read on a phone,
  // so it gets a full-width tap-to-copy row showing the shortened form.
  const copyFacts = facts.flatMap((fact) => (fact.copy ? [{ ...fact, copy: fact.copy }] : []));
  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`Sync details — ${server.name}`}
      description="The bookkeeping behind the sync line: what PolySIEM wants, what the edge last confirmed."
    >
      <div className="flex flex-col gap-3 pb-2">
        <div className="rounded-xl border bg-card px-3.5 py-2.5">
          <p className={cn("text-[13px] font-medium", syncToneClass(summary.tone))}>{summary.headline}</p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{summary.detail}</p>
        </div>
        <MobileList>
          {facts
            .filter((fact) => !fact.copy)
            .map((fact) => (
              <MobileKeyRow key={fact.label} label={fact.label} mono={fact.mono}>
                {fact.label === SHARED_FORWARDING_FACT ? edgeForwardingLabel(server) : fact.value}
              </MobileKeyRow>
            ))}
          <MobileKeyRow label="Last applied">{relativeOr(settings.lastAppliedAt, "Never")}</MobileKeyRow>
          <MobileKeyRow label="Last verified">{relativeOr(settings.lastVerifiedAt, "Never")}</MobileKeyRow>
          <MobileKeyRow label="SSH host key">{edgeHostKeyLabel(server)}</MobileKeyRow>
        </MobileList>
        {copyFacts.map((fact) => (
          <MobileCopyRow key={fact.label} label={fact.label} value={fact.copy} display={fact.value} />
        ))}
      </div>
    </BottomSheet>
  );
}

/**
 * The actions that are real but rarely wanted. Keeping them here leaves Apply
 * as the one primary button, and gives "Test connection" a name that cannot be
 * confused with the host-key trust it does not change.
 */
export function EdgeMoreSheet({
  server,
  onOpenChange,
  onOpenDetails,
}: {
  server: EdgeNatServer;
  onOpenChange: (open: boolean) => void;
  onOpenDetails: () => void;
}) {
  const verifyMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; detail: string }>(`/api/admin/integrations/${server.id}/test`, { method: "POST" }),
    onSuccess: (result) =>
      result.ok
        ? toast.success(result.detail || "SSH connection verified")
        : toast.error(result.detail || "SSH verification failed"),
    onError: (error: Error) => toast.error(`SSH verification failed: ${error.message}`),
  });

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={server.name}
      description="Checks and diagnostics for this edge box."
    >
      <MobileList className="mb-2">
        {server.hostKeyEnrolled && (
          <MobileListRow
            onClick={() => verifyMutation.mutate()}
            leading={
              verifyMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <ScanLine className="size-4" />
            }
            title="Test connection"
            subtitle="Open an SSH session now and report what happens."
          />
        )}
        <MobileListRow
          onClick={onOpenDetails}
          leading={<SlidersHorizontal className="size-4" />}
          title="Sync details"
          subtitle="Revisions, rule hashes, host key, forwarding."
        />
      </MobileList>
    </BottomSheet>
  );
}

/** Only for a disabled server whose remote rules were never cleared. */
export function EdgeCleanupAction({ server }: { server: EdgeNatServer }) {
  const queryClient = useQueryClient();
  const [clearOpen, setClearOpen] = useState(false);
  const clearMutation = useMutation({
    mutationFn: () => apiFetch(`/api/network/edge-networks/servers/${server.id}/clear`, { method: "POST" }),
    onSuccess: () => {
      toast.success(`Remote NAT rules cleared on ${server.name}`);
      setClearOpen(false);
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
    },
    onError: (error: Error) => toast.error(`Remote cleanup failed: ${error.message}`),
  });

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setClearOpen(true)}>
        <Trash2 /> Clear remote rules
      </Button>
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear every remote NAT rule on {server.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This sends an empty managed ruleset to the edge server. Desired rules remain saved in PolySIEM, but
              traffic may continue until the remote server confirms cleanup.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={clearMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                clearMutation.mutate();
              }}
            >
              {clearMutation.isPending && <Loader2 className="animate-spin" />}
              Clear remote rules
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
