"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleCheck, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import {
  EMPTY_PRIVACY_ROUTER_IDENTITY,
  privacyRouterCreateBody,
  privacyRouterTopologyBody,
  usePrivacyTopologyForm,
  type PrivacyRouterIdentityForm,
} from "@/components/network/privacy-router-enrollment";
import {
  privacyRouterIdentityError,
  privacyRouterTopologyError,
  PRIVACY_ROUTER_ADD_STEPS,
  PRIVACY_ROUTER_ADMIN_ACCOUNT_NOTE,
  PRIVACY_ROUTER_BOOTSTRAP_NOTE,
  PRIVACY_ROUTER_SSH_ADDRESS_NOTE,
  PRIVACY_ROUTER_SSH_PORT_NOTE,
  PRIVACY_ROUTER_TOPOLOGY_CONFIRM_NOTE,
  PRIVACY_ROUTER_VERIFY_NOTE,
  type PrivacyRouterAddStepId,
} from "@/components/network/privacy-router-presentation";
import {
  privacyRouterEnrollmentQueryKey,
  privacyRouterHostKeyQueryKey,
  privacyRouterHostKeyUrl,
  privacyRouterProvisionUrl,
  privacyRouterUrl,
  privacyRoutersUrl,
  PRIVACY_ROUTER_QUERY_PREFIX,
  type PrivacyRouterDto,
  type PrivacyRouterEnrollmentDto,
  type PrivacyRouterHostKeyProbe,
  type PrivacyRouterProvisionResult,
} from "@/components/network/privacy-router-types";
import { CommandBlock } from "../network-edge/mobile-connector-atoms";
import { MobilePrivacyHostKeyScan, preferredMobilePrivacyHostKey } from "./mobile-privacy-host-key";
import { MobilePrivacyIntro } from "./mobile-privacy-intro";
import { MobilePrivacyTopologyFields } from "./mobile-privacy-topology";
import { PrivacyListNote, PrivacyNotice } from "./mobile-privacy-atoms";

/**
 * Adding a privacy router on a phone, in the same four steps as the desktop
 * dialog and the same four steps an edge box is added in.
 *
 * Only one step's body is mounted at a time, which suits a sheet as well as it
 * suits a dialog: it keeps a step's queries from running before it is reached,
 * and it keeps the sheet to a height a thumb can reach the bottom of.
 */
export function MobilePrivacyAddSheet({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  /** Fired once, as soon as the router row exists — the page selects it. */
  onCreated?: (router: PrivacyRouterDto) => void;
}) {
  const [step, setStep] = useState<PrivacyRouterAddStepId>("identity");
  const [identity, setIdentity] = useState<PrivacyRouterIdentityForm>(EMPTY_PRIVACY_ROUTER_IDENTITY);
  const [router, setRouter] = useState<PrivacyRouterDto | null>(null);
  const [proof, setProof] = useState<PrivacyRouterProvisionResult | null>(null);
  const definition = PRIVACY_ROUTER_ADD_STEPS.find((one) => one.id === step) ?? PRIVACY_ROUTER_ADD_STEPS[0];

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`Step ${definition.number} of 4 · ${definition.title}`}
      description={definition.summary}
    >
      <div className="flex flex-col gap-4 pb-2">
        <MobilePrivacyStepStrip current={step} />

        {step === "identity" && (
          <>
            <MobilePrivacyIntro />
            <MobilePrivacyIdentityStep
              identity={identity}
              onChange={(patch) => setIdentity((current) => ({ ...current, ...patch }))}
              onCreated={(created) => { setRouter(created); onCreated?.(created); setStep("install"); }}
            />
          </>
        )}

        {step === "install" && router && (
          <MobilePrivacyInstallStep router={router} onAdvance={() => setStep("verify")} />
        )}

        {step === "verify" && router && (
          <MobilePrivacyVerifyStep
            router={router}
            adminUsername={identity.adminUsername}
            onVerified={(result) => { setRouter(result.router); setProof(result); setStep("topology"); }}
          />
        )}

        {step === "topology" && router && (
          <MobilePrivacyTopologyStep router={router} proof={proof} onFinished={() => onOpenChange(false)} />
        )}
      </div>
    </BottomSheet>
  );
}

/**
 * Where the operator is in the four steps.
 *
 * A phone has no room for the desktop's numbered grid with every step's summary
 * on screen, but "how much more of this is there" is the question the grid was
 * answering, and it is worth 24px to keep answering it.
 */
function MobilePrivacyStepStrip({ current }: { current: PrivacyRouterAddStepId }) {
  const order = PRIVACY_ROUTER_ADD_STEPS.map((step) => step.id);
  const index = order.indexOf(current);
  return (
    <ol className="flex items-center gap-1.5" aria-label={`Step ${index + 1} of ${order.length}`}>
      {PRIVACY_ROUTER_ADD_STEPS.map((step, position) => (
        <li key={step.id} className="flex flex-1 items-center gap-1.5">
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium",
              position <= index ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}
            aria-hidden="true"
          >
            {position < index ? <Check className="size-3" /> : step.number}
          </span>
          {position < order.length - 1 && (
            <span className={cn("h-px flex-1", position < index ? "bg-primary" : "bg-border")} aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1 — identity                                                   */
/* ------------------------------------------------------------------ */

function MobilePrivacyIdentityStep({
  identity,
  onChange,
  onCreated,
}: {
  identity: PrivacyRouterIdentityForm;
  onChange: (patch: Partial<PrivacyRouterIdentityForm>) => void;
  onCreated: (router: PrivacyRouterDto) => void;
}) {
  const [portOpen, setPortOpen] = useState(identity.port !== "22");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => apiFetch<PrivacyRouterDto>(privacyRoutersUrl(), {
      method: "POST",
      body: JSON.stringify(privacyRouterCreateBody(identity)),
    }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
      onCreated(created);
    },
    onError: (error: Error) => toast.error(`Could not add the router: ${error.message}`),
  });

  const submit = () => {
    const error = privacyRouterIdentityError(identity);
    if (error) { toast.error(error); return; }
    mutation.mutate();
  };

  return (
    <div className="flex flex-col gap-3">
      <MobilePrivacyField id="m-privacy-add-name" label="Name">
        <Input
          id="m-privacy-add-name"
          value={identity.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="Lab privacy router"
          maxLength={64}
        />
      </MobilePrivacyField>

      <MobilePrivacyField id="m-privacy-add-host" label="SSH address" help={PRIVACY_ROUTER_SSH_ADDRESS_NOTE}>
        <Input
          id="m-privacy-add-host"
          value={identity.host}
          onChange={(event) => onChange({ host: event.target.value })}
          placeholder="10.0.3.70"
          autoCapitalize="none"
          spellCheck={false}
        />
      </MobilePrivacyField>

      <MobilePrivacyField
        id="m-privacy-add-admin"
        label="Your administrator account on the box"
        help={PRIVACY_ROUTER_ADMIN_ACCOUNT_NOTE}
      >
        <Input
          id="m-privacy-add-admin"
          value={identity.adminUsername}
          onChange={(event) => onChange({ adminUsername: event.target.value })}
          placeholder="ubuntu"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={32}
        />
      </MobilePrivacyField>

      {portOpen ? (
        <MobilePrivacyField id="m-privacy-add-port" label="SSH port" help={PRIVACY_ROUTER_SSH_PORT_NOTE}>
          <Input
            id="m-privacy-add-port"
            inputMode="numeric"
            value={identity.port}
            onChange={(event) => onChange({ port: event.target.value })}
          />
        </MobilePrivacyField>
      ) : (
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setPortOpen(true)}>
          Change port
        </Button>
      )}

      <Button type="button" className="w-full" disabled={mutation.isPending} onClick={submit}>
        {mutation.isPending && <Loader2 className="animate-spin" />}Continue
      </Button>
    </div>
  );
}

function MobilePrivacyField({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {help && <p className="text-xs leading-snug text-muted-foreground">{help}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 — install                                                    */
/* ------------------------------------------------------------------ */

function MobilePrivacyInstallStep({ router, onAdvance }: { router: PrivacyRouterDto; onAdvance: () => void }) {
  // The command is minted server-side from the SAME `buildSshBootstrapCommand`
  // the edge box uses, so the bytes an operator pastes are the bytes the
  // installer expects. The UI never re-derives it.
  const enrollmentQuery = useQuery({
    queryKey: privacyRouterEnrollmentQueryKey(router.id),
    queryFn: () => apiFetch<PrivacyRouterEnrollmentDto>(privacyRouterProvisionUrl(router.id)),
    retry: false,
  });
  const enrollment = enrollmentQuery.data;

  if (enrollmentQuery.isError) {
    return (
      <PrivacyNotice
        tone="danger"
        title="Could not prepare this router's SSH identity"
        detail={(enrollmentQuery.error as Error).message}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <PrivacyListNote>
        PolySIEM generated an ed25519 keypair for {router.name}. Sign in to {router.ssh.host} as yourself and run this
        once.
      </PrivacyListNote>
      {enrollment ? (
        <CommandBlock
          label="Run as your own admin on the router"
          command={enrollment.bootstrapCommand}
          highlight
          copyLabel="Copy the setup command"
        />
      ) : (
        <Skeleton className="h-24 rounded-xl" />
      )}
      <PrivacyListNote>{PRIVACY_ROUTER_BOOTSTRAP_NOTE}</PrivacyListNote>
      <Button type="button" className="w-full" disabled={!enrollment} onClick={onAdvance}>I have run it</Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3 — connect and verify                                         */
/* ------------------------------------------------------------------ */

/**
 * Scan, pin, install — and only then, when the agent has answered.
 *
 * The endpoint fails with `privacy_router_provision_unverified` when the
 * installer finishes but the agent does not answer STATUS, so reaching
 * `onSuccess` IS the proof. The same round-trip carries the box's interfaces
 * back for step 4, so this flow never opens a second SSH session to find them.
 */
function MobilePrivacyVerifyStep({
  router,
  adminUsername,
  onVerified,
}: {
  router: PrivacyRouterDto;
  adminUsername: string;
  onVerified: (result: PrivacyRouterProvisionResult) => void;
}) {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState("");
  const probeQuery = useQuery({
    queryKey: privacyRouterHostKeyQueryKey(router.id),
    queryFn: () => apiFetch<PrivacyRouterHostKeyProbe>(privacyRouterHostKeyUrl(router.id)),
    retry: false,
  });
  const fingerprint = preferredMobilePrivacyHostKey(chosen, probeQuery.data);
  const install = useMutation({
    mutationFn: () => apiFetch<PrivacyRouterProvisionResult>(privacyRouterProvisionUrl(router.id), {
      method: "POST",
      body: JSON.stringify({ adminUsername: adminUsername.trim(), fingerprint }),
    }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
      onVerified(result);
    },
    onError: (error: Error) => toast.error(`Could not install the router agent: ${error.message}`),
  });

  return (
    <div className="flex flex-col gap-3">
      <MobilePrivacyHostKeyScan
        probeQuery={probeQuery}
        selected={fingerprint}
        enrolled={router.ssh.hostKeyFingerprint}
        onSelect={setChosen}
      />
      <PrivacyListNote>{PRIVACY_ROUTER_VERIFY_NOTE}</PrivacyListNote>

      {install.isPending && (
        <PrivacyNotice
          tone="info"
          title="Installing the restricted privacy router agent"
          detail="Keep this page open. PolySIEM is connecting over pinned SSH, installing the agent and the verified SNI proxy, removing its temporary setup access, and then asking the agent for STATUS. On a fresh box this takes a few minutes."
        />
      )}

      <Button
        type="button"
        className="w-full"
        disabled={!fingerprint || install.isPending}
        onClick={() => install.mutate()}
      >
        {install.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
        Trust host and install the agent
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 4 — confirm what we found                                      */
/* ------------------------------------------------------------------ */

function MobilePrivacyTopologyStep({
  router,
  proof,
  onFinished,
}: {
  router: PrivacyRouterDto;
  proof: PrivacyRouterProvisionResult | null;
  onFinished: () => void;
}) {
  const queryClient = useQueryClient();
  const interfaces = proof?.interfaces ?? [];
  const { form, setForm, summary } = usePrivacyTopologyForm(interfaces, router.ssh.host, router);
  const save = useMutation({
    mutationFn: () => apiFetch<PrivacyRouterDto>(privacyRouterUrl(router.id), {
      method: "PATCH",
      body: JSON.stringify(privacyRouterTopologyBody(form)),
    }),
    onSuccess: () => {
      toast.success(`${router.name} is ready. Add an exit and a rule, then apply the configuration.`);
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
      onFinished();
    },
    onError: (error: Error) => toast.error(`Could not save the topology: ${error.message}`),
  });

  const submit = () => {
    const error = privacyRouterTopologyError(form);
    if (error) { toast.error(error); return; }
    save.mutate();
  };

  return (
    <div className="flex flex-col gap-3">
      {proof && (
        <p className="flex items-start gap-1.5 text-xs leading-snug text-success">
          <CircleCheck className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {/* The service's own report of what it proved, printed verbatim on
              both surfaces rather than re-worded here. */}
          <span>{proof.detail}</span>
        </p>
      )}
      <MobilePrivacyTopologyFields
        form={form}
        interfaces={interfaces}
        summary={summary}
        exitCount={router.exitCount}
        onChange={setForm}
      />
      <PrivacyListNote>{PRIVACY_ROUTER_TOPOLOGY_CONFIRM_NOTE}</PrivacyListNote>
      <Button type="button" className="w-full" disabled={save.isPending} onClick={submit}>
        {save.isPending && <Loader2 className="animate-spin" />}Save and finish
      </Button>
    </div>
  );
}
