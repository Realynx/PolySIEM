"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleCheck, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EMPTY_PRIVACY_ROUTER_IDENTITY,
  privacyRouterCreateBody,
  privacyRouterTopologyBody,
  usePrivacyTopologyForm,
  type PrivacyRouterIdentityForm,
} from "./privacy-router-enrollment";
import { PrivacyBootstrapCommand, PrivacyHostKeyScan, preferredPrivacyHostKey } from "./privacy-router-host-key";
import { PrivacyRouterIntroBlock } from "./privacy-router-intro";
import { PrivacyTopologyFields } from "./privacy-router-confirm-topology";
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
} from "./privacy-router-presentation";
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
} from "./privacy-router-types";

/**
 * Adding a privacy router, in the four steps the edge box is added in.
 *
 * The first cut of this screen was one form holding eleven fields, and the
 * review it got was "the options to configure seems like a bit much right off
 * the initial modal… I'm not even really sure what the privacy router is as a
 * user just clicking this at this point." Both halves of that are answered
 * here: the dialog opens by saying what the thing is, and then asks for exactly
 * three things it cannot find out for itself.
 *
 * Everything else the old form asked for is either detected (step 4) or has
 * moved to where its meaning is legible — proxy ports and the QUIC block to
 * Router settings, the default action to the foot of the Rules tab, where it is
 * the last line of a firewall rather than a dropdown before any rule exists.
 *
 * Step 3 is the "synchronize the two to make sure they connect" the operator
 * asked for, and it is deliberate that it does not finish on a successful SSH
 * command: it finishes when the restricted agent answers STATUS.
 */
export function PrivacyRouterAddDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired once, as soon as the router row exists — the page selects it. */
  onCreated?: (router: PrivacyRouterDto) => void;
}) {
  const [step, setStep] = useState<PrivacyRouterAddStepId>("identity");
  const [identity, setIdentity] = useState<PrivacyRouterIdentityForm>(EMPTY_PRIVACY_ROUTER_IDENTITY);
  const [router, setRouter] = useState<PrivacyRouterDto | null>(null);
  const [proof, setProof] = useState<PrivacyRouterProvisionResult | null>(null);

  const reset = () => {
    setStep("identity");
    setIdentity(EMPTY_PRIVACY_ROUTER_IDENTITY);
    setRouter(null);
    setProof(null);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) reset(); onOpenChange(next); }}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a privacy router</DialogTitle>
          <DialogDescription>
            PolySIEM installs a restricted agent on a Linux box you already have, over SSH. It takes four steps.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {step === "identity" && <PrivacyRouterIntroBlock />}

          {PRIVACY_ROUTER_ADD_STEPS.map((definition) => (
            <PrivacyAddStep
              key={definition.id}
              number={definition.number}
              title={definition.title}
              summary={definition.summary}
              state={addStepState(definition.id, step)}
            >
              {definition.id === step && (
                <PrivacyAddStepBody
                  step={step}
                  identity={identity}
                  router={router}
                  proof={proof}
                  onIdentityChange={(patch) => setIdentity((current) => ({ ...current, ...patch }))}
                  onCreated={(created) => { setRouter(created); onCreated?.(created); setStep("install"); }}
                  onVerified={(result) => { setRouter(result.router); setProof(result); setStep("topology"); }}
                  onFinished={() => onOpenChange(false)}
                  onAdvance={() => setStep("verify")}
                />
              )}
            </PrivacyAddStep>
          ))}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{router ? "Finish later" : "Cancel"}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PrivacyAddStepState = "done" | "active" | "todo";

/** Steps before the current one are done: this flow only ever moves forward. */
function addStepState(id: PrivacyRouterAddStepId, current: PrivacyRouterAddStepId): PrivacyAddStepState {
  if (id === current) return "active";
  const order = PRIVACY_ROUTER_ADD_STEPS.map((step) => step.id);
  return order.indexOf(id) < order.indexOf(current) ? "done" : "todo";
}

/**
 * One numbered step, in the same grid the edge box's enrollment dialog uses.
 *
 * All four are on screen the whole time, so the reader can see what they are in
 * for before they type anything; only the active one has a body, so a step's
 * queries do not run before it is reached.
 */
function PrivacyAddStep({
  number,
  title,
  summary,
  state,
  children,
}: {
  number: string;
  title: string;
  summary: string;
  state: PrivacyAddStepState;
  children: ReactNode;
}) {
  return (
    <section className={cn("grid gap-3 sm:grid-cols-[2rem_1fr]", state === "todo" && "opacity-60")}>
      <div
        className={cn(
          "flex size-7 items-center justify-center rounded-full text-xs font-medium",
          state === "todo" ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
        )}
        aria-hidden="true"
      >
        {state === "done" ? <Check className="size-4" /> : number}
      </div>
      <div className="min-w-0 space-y-3">
        <div className="min-w-0">
          <h3 className="font-medium">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{summary}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

/** Which body the active step renders. Split out so the dialog itself stays flat. */
function PrivacyAddStepBody({
  step,
  identity,
  router,
  proof,
  onIdentityChange,
  onCreated,
  onAdvance,
  onVerified,
  onFinished,
}: {
  step: PrivacyRouterAddStepId;
  identity: PrivacyRouterIdentityForm;
  router: PrivacyRouterDto | null;
  proof: PrivacyRouterProvisionResult | null;
  onIdentityChange: (patch: Partial<PrivacyRouterIdentityForm>) => void;
  onCreated: (router: PrivacyRouterDto) => void;
  onAdvance: () => void;
  onVerified: (result: PrivacyRouterProvisionResult) => void;
  onFinished: () => void;
}) {
  if (step === "identity") {
    return <PrivacyIdentityStep identity={identity} onChange={onIdentityChange} onCreated={onCreated} />;
  }
  if (!router) return null;
  if (step === "install") return <PrivacyInstallStep router={router} onAdvance={onAdvance} />;
  if (step === "verify") {
    return <PrivacyVerifyStep router={router} adminUsername={identity.adminUsername} onVerified={onVerified} />;
  }
  return <PrivacyTopologyStep router={router} proof={proof} onFinished={onFinished} />;
}

/* ------------------------------------------------------------------ */
/* Step 1 — identity                                                   */
/* ------------------------------------------------------------------ */

function PrivacyIdentityStep({
  identity,
  onChange,
  onCreated,
}: {
  identity: PrivacyRouterIdentityForm;
  onChange: (patch: Partial<PrivacyRouterIdentityForm>) => void;
  onCreated: (router: PrivacyRouterDto) => void;
}) {
  // Port is behind a disclosure because 22 is right virtually always, and a
  // fourth field on the first screen is exactly what this redesign is undoing.
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
    <div className="space-y-3">
      <div className="grid gap-1.5">
        <Label htmlFor="privacy-add-name">Name</Label>
        <Input
          id="privacy-add-name"
          value={identity.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="Lab privacy router"
          maxLength={64}
          autoFocus
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="privacy-add-host">SSH address</Label>
        <Input
          id="privacy-add-host"
          value={identity.host}
          onChange={(event) => onChange({ host: event.target.value })}
          placeholder="10.0.3.70"
          autoCapitalize="none"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">{PRIVACY_ROUTER_SSH_ADDRESS_NOTE}</p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="privacy-add-admin">Your administrator account on the box</Label>
        <Input
          id="privacy-add-admin"
          value={identity.adminUsername}
          onChange={(event) => onChange({ adminUsername: event.target.value })}
          placeholder="ubuntu"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={32}
        />
        <p className="text-xs text-muted-foreground">{PRIVACY_ROUTER_ADMIN_ACCOUNT_NOTE}</p>
      </div>

      {portOpen ? (
        <div className="grid max-w-40 gap-1.5">
          <Label htmlFor="privacy-add-port">SSH port</Label>
          <Input
            id="privacy-add-port"
            inputMode="numeric"
            value={identity.port}
            onChange={(event) => onChange({ port: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">{PRIVACY_ROUTER_SSH_PORT_NOTE}</p>
        </div>
      ) : (
        <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => setPortOpen(true)}>
          Change port
        </Button>
      )}

      <Button type="button" disabled={mutation.isPending} onClick={submit}>
        {mutation.isPending && <Loader2 className="animate-spin" />}Continue
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 — install                                                    */
/* ------------------------------------------------------------------ */

function PrivacyInstallStep({ router, onAdvance }: { router: PrivacyRouterDto; onAdvance: () => void }) {
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
      <Alert variant="destructive">
        <AlertTitle>Could not prepare this router&apos;s SSH identity</AlertTitle>
        <AlertDescription>{(enrollmentQuery.error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        PolySIEM generated an ed25519 keypair for {router.name}. Sign in to{" "}
        <code className="font-mono">{router.ssh.host}</code> as yourself and run this once.
      </p>
      {enrollment
        ? <PrivacyBootstrapCommand command={enrollment.bootstrapCommand} label="Copy the setup command" />
        : <Skeleton className="h-24 rounded-lg" />}
      <p className="text-xs text-muted-foreground">{PRIVACY_ROUTER_BOOTSTRAP_NOTE}</p>
      <Button type="button" disabled={!enrollment} onClick={onAdvance}>I have run it</Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3 — connect and verify                                         */
/* ------------------------------------------------------------------ */

/**
 * Scan, pin, install — and only then, when the agent has answered.
 *
 * The last part is the point. "The install script exited zero" and "PolySIEM
 * can manage this box" are different claims, and only the second one is worth
 * moving the operator on from. The endpoint itself enforces that: it fails with
 * `privacy_router_provision_unverified` when the installer finishes but the
 * agent does not answer STATUS, so reaching `onSuccess` IS the proof. The same
 * round-trip carries the box's interfaces back for step 4, which is why this
 * flow never opens a second SSH session to find them.
 */
function PrivacyVerifyStep({
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
  const fingerprint = preferredPrivacyHostKey(chosen, probeQuery.data);
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
    <div className="space-y-3">
      <PrivacyHostKeyScan
        probeQuery={probeQuery}
        selected={fingerprint}
        enrolled={router.ssh.hostKeyFingerprint}
        onSelect={setChosen}
      />
      <p className="text-xs text-muted-foreground">{PRIVACY_ROUTER_VERIFY_NOTE}</p>

      {install.isPending && (
        <Alert>
          <Loader2 className="animate-spin" />
          <AlertTitle>Installing the restricted privacy router agent</AlertTitle>
          <AlertDescription>
            Keep this window open. PolySIEM is connecting over pinned SSH, installing the agent and the verified SNI
            proxy, removing its temporary setup access, and then asking the agent for STATUS. On a fresh box this takes
            a few minutes.
          </AlertDescription>
        </Alert>
      )}

      <Button type="button" disabled={!fingerprint || install.isPending} onClick={() => install.mutate()}>
        {install.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
        Trust host and install the agent
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 4 — confirm what we found                                      */
/* ------------------------------------------------------------------ */

function PrivacyTopologyStep({
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
    <div className="space-y-3">
      {proof && (
        <p className="flex items-start gap-1.5 text-xs text-success">
          <CircleCheck className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {/* The service's own report of what it proved, printed verbatim on
              both surfaces rather than re-worded here. */}
          <span>{proof.detail}</span>
        </p>
      )}
      <PrivacyTopologyFields
        form={form}
        interfaces={interfaces}
        summary={summary}
        exitCount={router.exitCount}
        onChange={setForm}
      />
      <p className="text-xs text-muted-foreground">{PRIVACY_ROUTER_TOPOLOGY_CONFIRM_NOTE}</p>
      <Button type="button" disabled={save.isPending} onClick={submit}>
        {save.isPending && <Loader2 className="animate-spin" />}Save and finish
      </Button>
    </div>
  );
}
