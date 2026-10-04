"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Circle, CircleCheck, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { pushWithNavigationFeedback } from "@/components/shell/navigation-feedback";
import { apiFetch } from "@/components/shared/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { MobileSection } from "@/components/mobile/ui/mobile-page";
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
} from "@/components/network/privacy-router-presentation";
import {
  scrollToPrivacyWalkthrough,
  usePrivacyGatewayAck,
} from "@/components/network/privacy-router-gateway-step";
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
} from "@/components/network/privacy-router-types";
import { CommandBlock } from "../network-edge/mobile-connector-atoms";
import { MobilePrivacyHostKeyScan, preferredMobilePrivacyHostKey } from "./mobile-privacy-host-key";
import { MobilePrivacySetupDisclosure } from "./mobile-privacy-instructions";
import { MobilePrivacyTopologySection } from "./mobile-privacy-topology";
import { PrivacyListNote, PrivacyNotice } from "./mobile-privacy-atoms";

/**
 * The Setup tab on a phone — one next action, the machinery for it, and the
 * reference material folded away underneath.
 *
 * Same order as the desktop tab and for the same reason: the page opens with the
 * single outstanding step from `privacyRouterSetupFocus`, then the panels that
 * do it, then the two walkthroughs COLLAPSED. Both walkthroughs render from the
 * same pure functions as the desktop tab: this is expected setup rather than a
 * fault, and the headline alone is enough for someone who already knows. The
 * scan-and-pin surface is the shared one that step 3 of the add sheet also uses.
 *
 * The last step is done in OPNsense, so its button opens the gateway walkthrough
 * rather than pushing to another tab: `gatewayOpenRequest` is incremented by
 * that tap and by nothing else. Mounting state cannot open a walkthrough — see
 * `network/use-disclosure-open-request.ts`.
 */
export function MobilePrivacySetupPanel({ router, isAdmin }: { router: PrivacyRouterDto; isAdmin: boolean }) {
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

  return (
    <>
      <MobilePrivacyNextStep
        router={router}
        acknowledged={acknowledged}
        onAcknowledge={setAcknowledged}
        onShowWalkthrough={(id) => {
          setGatewayOpenRequest((request) => request + 1);
          scrollToPrivacyWalkthrough(id);
        }}
      />

      {isAdmin && (
        <PrivacyEnrollmentSection
          router={router}
          enrollment={enrollment}
          enrollmentError={enrollmentQuery.error as Error | null}
        />
      )}

      {/* Only while it is unconfirmed: once the three values are stored, they
          are ordinary settings and live in the settings sheet with the rest. */}
      {isAdmin && !privacyRouterTopologyConfirmed(router) && <MobilePrivacyTopologySection router={router} />}

      <MobilePrivacySetupDisclosure
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

      <MobilePrivacySetupDisclosure
        instructions={privacyRouterGatewayInstructions({
          routerName: router.name,
          lanAddress: router.ssh.host,
          lanCidr: router.lanCidr,
          lanInterface: router.lanInterface,
          clientNetworks: router.clientNetworks,
        })}
        openRequest={gatewayOpenRequest}
      />
    </>
  );
}

/**
 * The one thing to do now, and the six-step sequence it sits in.
 *
 * Every word comes from `privacyRouterSetupFocus`, so a phone and a laptop
 * cannot disagree about which step a router is on. Neutral throughout: an
 * unfinished router is partway through expected setup, not a fault, so nothing
 * here is amber and nothing is a notice.
 *
 * Step 6 is the one PolySIEM cannot do or check, so it gets two controls rather
 * than one: a button into the OPNsense walkthrough on this same page, and the
 * operator's own tick.
 */
function MobilePrivacyNextStep({
  router,
  acknowledged,
  onAcknowledge,
  onShowWalkthrough,
}: {
  router: PrivacyRouterDto;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  onShowWalkthrough: (instructionsId: string) => void;
}) {
  const nextRouter = useRouter();
  const focus = privacyRouterSetupFocus(router, acknowledged);
  const next = focus.next;
  const target = next?.tab ?? null;
  const walkthrough = next?.walkthrough ?? null;
  // A step points at a tab or at a walkthrough, never both. The walkthrough is
  // on THIS page, so it opens in place rather than pushing a route.
  const act = walkthrough
    ? () => onShowWalkthrough(walkthrough)
    : target
      ? () => pushWithNavigationFeedback(nextRouter, `/network/privacy-router?tab=${target}`)
      : null;
  return (
    <section className="rounded-xl border bg-card px-3 py-3" aria-label="What to do next">
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {next ? <ArrowRight className="size-4" aria-hidden="true" /> : <CircleCheck className="size-4" aria-hidden="true" />}
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            {next ? "Do this next" : "Setup"} · {focus.progress}
          </p>
          <p className="mt-0.5 text-[13px] leading-tight font-medium">{focus.headline}</p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{focus.detail}</p>
          {next && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{next.where}</p>}
        </div>
      </div>

      {next?.actionLabel && act && (
        <Button className="mt-3 w-full" onClick={act}>
          {next.actionLabel}
        </Button>
      )}

      <ol className="mt-3 flex flex-col gap-1.5 border-t pt-2.5">
        {focus.steps.map((step) => (
          <MobilePrivacyStepRow key={step.id} step={step} current={step.id === next?.id} />
        ))}
      </ol>

      {privacyGatewayAckReady(focus) && (
        <MobilePrivacyGatewayAckRow acknowledged={acknowledged} onAcknowledge={onAcknowledge} />
      )}
    </section>
  );
}

/**
 * The operator's own tick for the step PolySIEM cannot see.
 *
 * A toggle rather than a "Done" button because it has to be revocable: a rebuilt
 * firewall un-does this step. The caveat prints beside it every time, so nothing
 * about the tick reads as a measurement.
 */
function MobilePrivacyGatewayAckRow({
  acknowledged,
  onAcknowledge,
}: {
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
}) {
  return (
    <div className="mt-2.5 border-t pt-2.5">
      <button
        type="button"
        aria-pressed={acknowledged}
        className="flex min-h-11 w-full items-start gap-2 rounded-lg px-1 py-1 text-left active:bg-muted/60"
        onClick={() => onAcknowledge(!acknowledged)}
      >
        {acknowledged
          ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className="min-w-0 text-xs leading-snug font-medium">{PRIVACY_GATEWAY_ACK_LABEL}</span>
      </button>
      <p className="mt-1 px-1 text-[11px] leading-snug text-muted-foreground">{PRIVACY_GATEWAY_ACK_NOTE}</p>
    </div>
  );
}

/**
 * One line of the sequence: done, current, or still ahead.
 *
 * A step PolySIEM cannot verify says so to a screen reader, so a tick the
 * operator put there never reads as one PolySIEM measured.
 */
function MobilePrivacyStepRow({ step, current }: { step: PrivacyRouterSetupStep; current: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={cn(
          "flex size-4.5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
          step.done && "bg-primary/10 text-primary",
          !step.done && current && "bg-primary text-primary-foreground",
          !step.done && !current && "border text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {step.done ? <Check className="size-2.5" /> : step.position}
      </span>
      <span className={cn("min-w-0 truncate text-xs", current ? "font-medium" : "text-muted-foreground")}>
        {step.title}
      </span>
      {step.done && <span className="sr-only">{step.verifiable ? "done" : "done — your own confirmation"}</span>}
    </li>
  );
}

/**
 * Scan, confirm, pin, install — one section, because they are one decision.
 *
 * Observing a host key is not trusting it: the operator compares a scanned
 * fingerprint against the router's own console and pins THAT one, after which a
 * changed host key is refused rather than accepted on trust.
 */
function PrivacyEnrollmentSection({
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
  const fingerprint = preferredMobilePrivacyHostKey(selected, hostKeyQuery.data);

  const enrollMutation = useMutation({
    mutationFn: (value: string) =>
      apiFetch(privacyRouterHostKeyUrl(router.id), { method: "POST", body: JSON.stringify({ fingerprint: value }) }),
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
      <PrivacyNotice
        tone="danger"
        title="Could not prepare this router's SSH identity"
        detail={enrollmentError.message}
      />
    );
  }

  const provisioned = Boolean(router.ssh.provisionedAt);
  const bootstrap = privacyRouterBootstrapAuthorization(provisioned);

  return (
    <MobileSection title="SSH enrollment">
      <PrivacyListNote>{privacyRouterEnrollmentIntro(router.name, provisioned)}</PrivacyListNote>

      {enrollment ? (
        <>
          <CommandBlock
            label="Run as your own admin on the router"
            command={enrollment.bootstrapCommand}
            highlight
            copyLabel="Copy the bootstrap command"
          />
          <PrivacyListNote>{bootstrap.what}</PrivacyListNote>
          {bootstrap.again && (
            <PrivacyNotice
              tone="info"
              title="A reinstall needs this command run again"
              detail={bootstrap.again}
            />
          )}
        </>
      ) : (
        <Skeleton className="h-24 rounded-xl" />
      )}

      <MobilePrivacyHostKeyScan
        probeQuery={hostKeyQuery}
        selected={fingerprint}
        enrolled={router.ssh.hostKeyFingerprint}
        onSelect={setSelected}
      />

      <div className="grid gap-1.5">
        <Label htmlFor="m-privacy-admin-username">Your administrator account on the router</Label>
        <Input
          id="m-privacy-admin-username"
          value={adminUsername}
          onChange={(event) => setAdminUsername(event.target.value)}
          placeholder="ubuntu"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={32}
        />
        <p className="text-xs leading-snug text-muted-foreground">{PRIVACY_ROUTER_ADMIN_ACCOUNT_NOTE}</p>
      </div>

      {provisionMutation.isPending && (
        <PrivacyNotice
          tone="info"
          title="Installing the restricted privacy router agent"
          detail="Keep this page open. PolySIEM is connecting over pinned SSH, installing the agent and the verified SNI proxy, removing its temporary setup access, and checking the result. On a fresh box this takes a few minutes."
        />
      )}

      <Button
        className="w-full"
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
        className="w-full"
        disabled={!fingerprint || fingerprint === router.ssh.hostKeyFingerprint || enrollMutation.isPending}
        onClick={() => enrollMutation.mutate(fingerprint)}
      >
        {enrollMutation.isPending ? <Loader2 className="animate-spin" /> : <LockKeyhole />}
        Pin the host key only
      </Button>
    </MobileSection>
  );
}
