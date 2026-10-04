"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { Check, CircleCheck, RefreshCw, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { preferredHostKeyFingerprint } from "@/components/ssh/host-key-selection";
import { CopyButton } from "@/components/ssh/copy-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { PrivacyRouterHostKeyProbe } from "./privacy-router-types";

/**
 * Scan the router's SSH host keys, show the fingerprints, pin one.
 *
 * This exists as its own module because the same surface is needed in two
 * places — the Setup tab of an existing router, and step 3 of the add flow —
 * and this codebase has already learned what happens when an enrollment screen
 * is copied instead of shared: there are several near-identical scan panels
 * across edge servers, connectors and this feature, and their preselect rule
 * had quietly diverged. The rule itself now lives in
 * `@/components/ssh/host-key-selection`; this is its desktop rendering, once.
 *
 * Observing a host key is not trusting it. The operator compares a scanned
 * fingerprint against the router's own console and pins THAT one; afterwards
 * every session is checked against exactly that key, and a changed one is
 * refused rather than accepted on trust.
 */
export function PrivacyHostKeyScan({
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
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{heading}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={probeQuery.isFetching}
          onClick={() => void probeQuery.refetch()}
        >
          <RefreshCw className={cn("size-4", probeQuery.isFetching && "animate-spin")} aria-hidden="true" /> Scan again
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {probe?.warning ?? "Compare a fingerprint with the router's own console before trusting it."}
      </p>

      {probeQuery.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {probeQuery.isError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Could not scan the SSH host key</AlertTitle>
          <AlertDescription>{(probeQuery.error as Error).message}</AlertDescription>
        </Alert>
      )}

      {probe && probe.keys.length === 0 && (
        <p className="text-sm text-warning">
          The router returned no host keys. Check that sshd is reachable on {probe.host}:{probe.port}.
        </p>
      )}

      {probe?.keys.map((key) => (
        <PrivacyHostKeyOption
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

function PrivacyHostKeyOption({
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
        "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent",
        active && "border-primary bg-primary/5",
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
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
          {algorithm}
          {enrolled && (
            <span className="inline-flex items-center gap-1 normal-case text-success">
              <CircleCheck className="size-3" aria-hidden="true" /> pinned
            </span>
          )}
        </span>
        <code className="block break-all text-xs">{fingerprint}</code>
      </span>
    </button>
  );
}

/** Which fingerprint a pin would take, given the probe and any explicit pick. */
export function preferredPrivacyHostKey(chosen: string, probe: PrivacyRouterHostKeyProbe | undefined): string {
  return preferredHostKeyFingerprint(chosen, probe?.enrolledFingerprint, probe?.keys ?? []);
}

/** The paste-in one-liner, with the copy control a long mono value earns. */
export function PrivacyBootstrapCommand({ command, label }: { command: string; label: string }) {
  return (
    <div className="relative rounded-lg bg-muted p-3 pr-12">
      <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all text-xs"><code>{command}</code></pre>
      <CopyButton value={command} label={label} className="absolute right-2 top-2" />
    </div>
  );
}
