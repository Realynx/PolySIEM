"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { Check, CircleCheck, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { preferredHostKeyFingerprint } from "@/components/ssh/host-key-selection";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PrivacyRouterHostKeyProbe } from "@/components/network/privacy-router-types";
import { PrivacyListNote, PrivacyNotice } from "./mobile-privacy-atoms";

/**
 * Scan the router's SSH host keys and pin one, on a phone.
 *
 * The same decision as the desktop panel and the same preselect rule — the rule
 * itself lives in `@/components/ssh/host-key-selection`, shared by every
 * enrollment surface in the product, because these panels had already been
 * copied enough times for their answers to diverge. What differs here is only
 * the treatment: 44px rows, no `Alert`, and a scan button that fits beside a
 * heading on a 412px strip.
 *
 * Used twice: the Setup tab of an existing router, and step 3 of the add sheet.
 */
export function MobilePrivacyHostKeyScan({
  probeQuery,
  selected,
  enrolled,
  onSelect,
  heading = "Confirm the router's identity",
}: {
  probeQuery: UseQueryResult<PrivacyRouterHostKeyProbe>;
  selected: string;
  enrolled: string | null;
  onSelect: (fingerprint: string) => void;
  heading?: string;
}) {
  const probe = probeQuery.data;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium">{heading}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={probeQuery.isFetching}
          onClick={() => void probeQuery.refetch()}
        >
          <RefreshCw className={cn("size-4", probeQuery.isFetching && "animate-spin")} aria-hidden="true" /> Scan
        </Button>
      </div>
      <PrivacyListNote>
        {probe?.warning ?? "Compare a fingerprint with the router's own console before trusting it."}
      </PrivacyListNote>

      {probeQuery.isLoading && (
        <>
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </>
      )}

      {probeQuery.isError && (
        <PrivacyNotice
          tone="danger"
          title="Could not scan the SSH host key"
          detail={(probeQuery.error as Error).message}
        />
      )}

      {probe && probe.keys.length === 0 && (
        <PrivacyNotice
          tone="warning"
          detail={`The router returned no host keys. Check that sshd is reachable on ${probe.host}:${probe.port}.`}
        />
      )}

      {probe?.keys.map((key) => (
        <MobilePrivacyHostKeyOption
          key={`${key.algorithm}:${key.fingerprint}`}
          algorithm={key.algorithm}
          fingerprint={key.fingerprint}
          active={selected === key.fingerprint}
          enrolled={enrolled === key.fingerprint}
          onSelect={() => onSelect(key.fingerprint)}
        />
      ))}
    </div>
  );
}

function MobilePrivacyHostKeyOption({
  algorithm,
  fingerprint,
  active,
  enrolled,
  onSelect,
}: {
  algorithm: string;
  fingerprint: string;
  active: boolean;
  enrolled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex min-h-13 w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
        active ? "border-primary bg-primary/5" : "bg-card active:bg-muted/70",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          active && "border-primary bg-primary text-primary-foreground",
        )}
      >
        {active && <Check className="size-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {algorithm}
          {enrolled && (
            <span className="inline-flex items-center gap-1 normal-case text-success">
              <CircleCheck className="size-3" aria-hidden="true" /> pinned
            </span>
          )}
        </span>
        <code className="mt-0.5 block font-mono text-[11px] break-all">{fingerprint}</code>
      </span>
    </button>
  );
}

/** Which fingerprint a pin would take, given the probe and any explicit pick. */
export function preferredMobilePrivacyHostKey(chosen: string, probe: PrivacyRouterHostKeyProbe | undefined): string {
  return preferredHostKeyFingerprint(chosen, probe?.enrolledFingerprint, probe?.keys ?? []);
}
