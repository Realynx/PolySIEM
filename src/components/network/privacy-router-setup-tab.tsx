"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Circle, CircleCheck, KeyRound, Loader2, LockKeyhole, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PrivacyRouterTopologyPanel } from "./privacy-router-confirm-topology";
import { PrivacyBootstrapCommand, PrivacyHostKeyScan, preferredPrivacyHostKey } from "./privacy-router-host-key";
import {
  isPrivacyRouterAdminUsername,
  privacyGatewayAckReady,
  privacyRouterBootstrapAuthorization,
  privacyRouterEnrollmentIntro,
  privacyRouterGatewayInstructions,
  privacyRouterInstallInstructions,
  privacyRouterSetupFocus,
  privacyRouterTopologyConfirmed,
  PRIVACY_GATEWAY_ACK_LABEL,
  PRIVACY_GATEWAY_ACK_NOTE,
  PRIVACY_ROUTER_ADMIN_ACCOUNT_NOTE,
  type PrivacyRouterSetupStep,
  type PrivacyRouterSetupTarget,
} from "./privacy-router-presentation";
import { scrollToPrivacyWalkthrough, usePrivacyGatewayAck } from "./privacy-router-gateway-step";
import { VpnSetupDisclosure } from "./privacy-router-setup-instructions";
import {
  privacyRouterEnrollmentQueryKey,
  privacyRouterHostKeyQueryKey,
  privacyRouterHostKeyUrl,
  privacyRouterProvisionUrl,
  PRIVACY_ROUTER_QUERY_PREFIX,
  type PrivacyRouterDto,
  type PrivacyRouterEnrollmentDto,
  type PrivacyRouterHostKeyProbe,
  type PrivacyRouterProvisionResult,
} from "./privacy-router-types";

/**
 * The Setup tab — one next action, the machinery for it, and the reference
 * material folded away underneath.
 *
 * The order matters and is the whole fix for "I really couldn't get my bearings
 * on the page as a user where I was supposed to look." The tab opens with the
 * single outstanding step, derived by `privacyRouterSetupFocus`; then the panels
 * that actually do it; then the two walkthroughs, COLLAPSED, because they are
 * reference and reference does not open itself.
 *
 * The last step is done in OPNsense, so its button opens the gateway walkthrough
 * rather than another tab: `gatewayOpenRequest` is incremented by that click and
 * by nothing else, which is the only way either disclosure is ever opened for a
 * reader. Mounting state cannot do it — see `use-disclosure-open-request.ts`.
 *
 * Both walkthroughs render from pure functions in `privacy-router-presentation.ts`,
 * so mobile prints the identical words. The scan-and-pin surface is the shared
 * one from `privacy-router-host-key.tsx`, which the add flow's step 3 also uses:
 * this codebase has already learned what happens when an enrollment panel is
 * copied instead of shared.
 */
export function PrivacyRouterSetupTab({
  router,
  isAdmin,
  onOpenTab,
}: {
  router: PrivacyRouterDto;
  isAdmin: boolean;
  /** Lets the next-step card send the operator to Exits or Rules. */
  onOpenTab?: (tab: PrivacyRouterSetupTarget) => void;
}) {
  // Minting the restricted identity is an admin-only write, so a read-only user
  // gets the walkthrough's headline and none of the machinery.
  const enrollmentQuery = useQuery({
    queryKey: privacyRouterEnrollmentQueryKey(router.id),
    queryFn: () => apiFetch<PrivacyRouterEnrollmentDto>(privacyRouterProvisionUrl(router.id)),
    enabled: isAdmin,
    retry: false,
  });
  const enrollment = enrollmentQuery.data;
  const [acknowledged, setAcknowledged] = usePrivacyGatewayAck(router.id);
  const [gatewayOpenRequest, setGatewayOpenRequest] = useState(0);
  const gatewayInstructions = privacyRouterGatewayInstructions({
    routerName: router.name,
    lanAddress: router.ssh.host,
    lanCidr: router.lanCidr,
    lanInterface: router.lanInterface,
    clientNetworks: router.clientNetworks,
  });

  return (
    <div className="space-y-5">
      <PrivacyRouterNextStepCard
        router={router}
        acknowledged={acknowledged}
        onAcknowledge={setAcknowledged}
        onOpenTab={onOpenTab}
        onShowWalkthrough={(id) => {
          setGatewayOpenRequest((request) => request + 1);
          scrollToPrivacyWalkthrough(id);
        }}
      />

      {isAdmin && (
        <PrivacyRouterEnrollmentPanel
          router={router}
          enrollment={enrollment}
          enrollmentError={enrollmentQuery.error as Error | null}
        />
      )}

      {/* Only while it is unconfirmed: once the three values are stored, they
          are ordinary settings and live in the Settings dialog with the rest. */}
      {isAdmin && !privacyRouterTopologyConfirmed(router) && <PrivacyRouterTopologyPanel router={router} />}

      <VpnSetupDisclosure
        instructions={privacyRouterInstallInstructions({
          routerName: router.name,
          sshUsername: enrollment?.sshUsername ?? router.ssh.username,
          host: router.ssh.host,
          port: router.ssh.port,
          bootstrapCommand: enrollment?.bootstrapCommand ?? null,
          hostKeyFingerprint: router.ssh.hostKeyFingerprint,
          provisionedAt: router.ssh.provisionedAt,
        })}
      />

      <VpnSetupDisclosure instructions={gatewayInstructions} openRequest={gatewayOpenRequest} />
    </div>
  );
}

/**
 * The one thing to do now, and the six-step sequence it sits in.
 *
 * Neutral throughout: an unfinished router is a router partway through expected
 * setup, not a fault, so nothing here is amber and nothing is an alert. What it
 * buys is a place for the eye to land — the previous tab was four panels of
 * equal weight and a reader with no way to rank them.
 *
 * Step 6 is the one PolySIEM cannot do or check, so it gets two controls rather
 * than one: a button into the OPNsense walkthrough, and the operator's own tick.
 */
function PrivacyRouterNextStepCard({
  router,
  acknowledged,
  onAcknowledge,
  onOpenTab,
  onShowWalkthrough,
}: {
  router: PrivacyRouterDto;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  onOpenTab?: (tab: PrivacyRouterSetupTarget) => void;
  onShowWalkthrough: (instructionsId: string) => void;
}) {
  const focus = privacyRouterSetupFocus(router, acknowledged);
  const next = focus.next;
  const target = next?.tab ?? null;
  const walkthrough = next?.walkthrough ?? null;
  // A step points at a tab or at a walkthrough, never both, so exactly one of
  // these is ever non-null and the button has one unambiguous destination.
  const act = walkthrough
    ? () => onShowWalkthrough(walkthrough)
    : target && onOpenTab
      ? () => onOpenTab(target)
      : null;
  return (
    <section className="rounded-lg border bg-muted/20 p-4" aria-label="What to do next">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {next
              ? <ArrowRight className="size-4.5" aria-hidden="true" />
              : <CircleCheck className="size-4.5" aria-hidden="true" />}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {next ? "Do this next" : "Setup"} · {focus.progress}
            </p>
            <p className="mt-0.5 text-sm font-medium">{focus.headline}</p>
            <p className="mt-1 text-sm text-muted-foreground">{focus.detail}</p>
            {next && <p className="mt-1 text-xs text-muted-foreground">{next.where}</p>}
          </div>
        </div>
        {next?.actionLabel && act && (
          <Button size="sm" className="shrink-0" onClick={act}>
            {next.actionLabel}
          </Button>
        )}
      </div>

      <ol className="mt-4 grid gap-1.5 border-t pt-3">
        {focus.steps.map((step) => (
          <PrivacyRouterStepRow key={step.id} step={step} current={step.id === next?.id} />
        ))}
      </ol>

      {privacyGatewayAckReady(focus) && (
        <PrivacyGatewayAckRow acknowledged={acknowledged} onAcknowledge={onAcknowledge} />
      )}
    </section>
  );
}

/**
 * The operator's own tick for the step PolySIEM cannot see.
 *
 * It is a toggle rather than a "Done" button because it has to be revocable: a
 * rebuilt firewall un-does this step, and a tick with no way back would become a
 * claim the operator can no longer correct. The caveat is printed beside it
 * every time, so nothing about the tick reads as a measurement.
 */
function PrivacyGatewayAckRow({
  acknowledged,
  onAcknowledge,
}: {
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
}) {
  return (
    <div className="mt-3 flex items-start gap-2.5 border-t pt-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={acknowledged}
        className="-ml-2 h-auto shrink-0 items-start gap-2 px-2 py-1 text-left whitespace-normal"
        onClick={() => onAcknowledge(!acknowledged)}
      >
        {acknowledged
          ? <CircleCheck className="mt-0.5 size-4 text-primary" aria-hidden="true" />
          : <Circle className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />}
        <span className="text-sm font-medium">{PRIVACY_GATEWAY_ACK_LABEL}</span>
      </Button>
      <p className="min-w-0 flex-1 pt-1 text-xs text-muted-foreground">{PRIVACY_GATEWAY_ACK_NOTE}</p>
    </div>
  );
}

/**
 * One line of the sequence: done, current, or still ahead.
 *
 * A step PolySIEM cannot verify carries its caveat on the row itself, so a tick
 * the operator put there never reads as one PolySIEM measured.
 */
function PrivacyRouterStepRow({ step, current }: { step: PrivacyRouterSetupStep; current: boolean }) {
  return (
    <li className="flex items-center gap-2.5 text-sm" title={step.unverifiableNote ?? undefined}>
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-medium",
          step.done && "bg-primary/10 text-primary",
          !step.done && current && "bg-primary text-primary-foreground",
          !step.done && !current && "border text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {step.done ? <Check className="size-3" /> : step.position}
      </span>
      <span className={cn("min-w-0 truncate", current ? "font-medium" : "text-muted-foreground")}>
        {step.title}
      </span>
      {step.done && <span className="sr-only">{step.verifiable ? "done" : "done — your own confirmation"}</span>}
    </li>
  );
}

/**
 * Scan, confirm, pin, install — one panel, because they are one decision.
 *
 * Observing a host key is not trusting it. The operator compares a scanned
 * fingerprint against the router's own console and pins THAT one; afterwards
 * every session is checked against exactly that key and a changed one is refused
 * rather than accepted on trust.
 */
function PrivacyRouterEnrollmentPanel({
  router,
  enrollment,
  enrollmentError,
}: {
  router: PrivacyRouterDto;
  enrollment: PrivacyRouterEnrollmentDto | undefined;
  enrollmentError: Error | null;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const hostKeyQuery = useQuery({
    queryKey: privacyRouterHostKeyQueryKey(router.id),
    queryFn: () => apiFetch<PrivacyRouterHostKeyProbe>(privacyRouterHostKeyUrl(router.id)),
    retry: false,
  });
  const fingerprint = preferredPrivacyHostKey(selected, hostKeyQuery.data);

  const enrollMutation = useMutation({
    mutationFn: (value: string) => apiFetch(privacyRouterHostKeyUrl(router.id), {
      method: "POST",
      body: JSON.stringify({ fingerprint: value }),
    }),
    onSuccess: () => {
      toast.success("Host key pinned. PolySIEM will refuse any other key from now on.");
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
    },
    onError: (error: Error) => toast.error(`Could not enroll the host key: ${error.message}`),
  });

  const provisionMutation = useMutation({
    mutationFn: (input: { adminUsername: string; fingerprint: string }) =>
      apiFetch<PrivacyRouterProvisionResult>(privacyRouterProvisionUrl(router.id), {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (result) => {
      toast.success(result.detail || "The privacy router agent is installed and answering.");
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
    },
    onError: (error: Error) => toast.error(`Could not install the router agent: ${error.message}`),
  });

  if (enrollmentError) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Could not prepare this router&apos;s SSH identity</AlertTitle>
        <AlertDescription>{enrollmentError.message}</AlertDescription>
      </Alert>
    );
  }

  const provisioned = Boolean(router.ssh.provisionedAt);
  const bootstrap = privacyRouterBootstrapAuthorization(provisioned);

  return (
    <section className="space-y-4 rounded-lg border p-4" aria-label="SSH enrollment">
      <div>
        <h3 className="text-sm font-medium">SSH enrollment</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {privacyRouterEnrollmentIntro(router.name, provisioned)}
        </p>
      </div>

      {enrollment ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Sign in to <code className="font-mono">{enrollment.host}</code> as your own administrator account and run
            this. {bootstrap.what}
          </p>
          <PrivacyBootstrapCommand command={enrollment.bootstrapCommand} label="Copy the bootstrap command" />
          {bootstrap.again && (
            <Alert>
              <KeyRound />
              <AlertTitle>A reinstall needs this command run again</AlertTitle>
              <AlertDescription>{bootstrap.again}</AlertDescription>
            </Alert>
          )}
        </div>
      ) : (
        <Skeleton className="h-24 rounded-lg" />
      )}

      <PrivacyHostKeyScan
        probeQuery={hostKeyQuery}
        selected={fingerprint}
        enrolled={router.ssh.hostKeyFingerprint}
        onSelect={setSelected}
      />

      <div className="grid gap-1.5">
        <Label htmlFor="privacy-admin-username">Your administrator account on the router</Label>
        <Input
          id="privacy-admin-username"
          value={adminUsername}
          onChange={(event) => setAdminUsername(event.target.value)}
          placeholder="ubuntu"
          autoComplete="username"
          maxLength={32}
        />
        <p className="text-xs text-muted-foreground">{PRIVACY_ROUTER_ADMIN_ACCOUNT_NOTE}</p>
      </div>

      {provisionMutation.isPending && (
        <Alert>
          <Loader2 className="animate-spin" />
          <AlertTitle>Installing the restricted privacy router agent</AlertTitle>
          <AlertDescription>
            Keep this page open. PolySIEM is connecting over pinned SSH, installing the agent and the verified SNI proxy,
            removing its temporary setup access, and checking the result. On a fresh box this takes a few minutes.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={
            !fingerprint
            || !isPrivacyRouterAdminUsername(adminUsername, enrollment?.sshUsername)
            || provisionMutation.isPending
          }
          onClick={() => provisionMutation.mutate({ adminUsername: adminUsername.trim(), fingerprint })}
        >
          {provisionMutation.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
          {router.ssh.provisionedAt ? "Reinstall the agent" : "Trust host and install the agent"}
        </Button>
        <Button
          variant="outline"
          disabled={!fingerprint || fingerprint === router.ssh.hostKeyFingerprint || enrollMutation.isPending}
          onClick={() => enrollMutation.mutate(fingerprint)}
        >
          {enrollMutation.isPending ? <Loader2 className="animate-spin" /> : <LockKeyhole />}
          Pin the host key only
        </Button>
      </div>
    </section>
  );
}
