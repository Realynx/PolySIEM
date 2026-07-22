"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  PlugZap,
  Plus,
  SkipForward,
  Sparkles,
} from "lucide-react";
import { AppLogo } from "@/components/shell/app-logo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { IntegrationFormDialog } from "@/components/settings/integration-form-dialog";
import { AiSettingsForm } from "@/components/settings/ai-settings-form";
import {
  INTEGRATION_TYPE_META,
  type IntegrationView,
} from "@/components/settings/integrations-manager";
import { cn } from "@/lib/utils";
import type { OllamaConfigView, SetupStage } from "@/lib/settings";
import type { ThemeColor } from "@/lib/types";
import {
  DASHBOARD_TOUR_SLIDES,
  DashboardTutorialPreview,
} from "./dashboard-tutorial";
import { AdministratorStep, PreferencesStep, WelcomeStep } from "./setup-account-steps";
import { SETUP_STEPS, setupInitialStep, validateAdministrator } from "./setup-wizard-model";

interface ApiEnvelope<T> {
  data?: T;
  error?: { message?: string };
}

function setupCardWidth(step: number): string {
  if (step === 5) return "max-w-5xl";
  if (step === 3 || step === 4) return "max-w-3xl";
  return "max-w-lg";
}

function SetupProgress({ step }: { step: number }) {
  return (
    <ol className="flex flex-wrap items-center justify-center gap-2">
      {SETUP_STEPS.map((label, index) => (
        <li key={label} className="flex items-center gap-2">
          <span className={cn(
            "flex size-6 items-center justify-center rounded-full text-xs font-medium transition-colors",
            index < step ? "bg-primary text-primary-foreground" : index === step ? "border-2 border-primary text-primary" : "border border-border text-muted-foreground",
          )}>
            {index < step ? <Check className="size-3.5" /> : index + 1}
          </span>
          <span className={cn("text-xs sm:text-sm", index === step ? "font-medium" : "text-muted-foreground")}>{label}</span>
          {index < SETUP_STEPS.length - 1 && <span className="mx-1 hidden h-px w-5 bg-border sm:block" />}
        </li>
      ))}
    </ol>
  );
}

function showSetupStep(active: boolean, content: React.ReactNode): React.ReactNode {
  return active ? content : null;
}

export function SetupWizard({
  initialStage,
  initialAiConfig,
}: {
  initialStage: SetupStage;
  initialAiConfig: OllamaConfigView;
}) {
  const router = useRouter();
  const [step, setStep] = useState(() => setupInitialStep(initialStage));
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [instanceName, setInstanceName] = useState("PolySIEM");
  const [themeColor, setThemeColor] = useState<ThemeColor>("blue");
  const [aiChoice, setAiChoice] = useState<
    "ask-enable" | "ask-configure" | "configure"
  >(() =>
    initialStage === "ai" && initialAiConfig.enabled
      ? "configure"
      : "ask-enable",
  );
  const [integrationChoice, setIntegrationChoice] = useState<"ask" | "configure">("ask");
  const [integrations, setIntegrations] = useState<IntegrationView[]>([]);
  const [integrationDialogOpen, setIntegrationDialogOpen] = useState(false);
  const [tourSlide, setTourSlide] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const activeSteps = SETUP_STEPS.map((_, index) => index === step);

  const refreshIntegrations = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/integrations", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as ApiEnvelope<IntegrationView[]>;
      setIntegrations(body.data ?? []);
    } catch {
      // The installer stays usable if the optional summary cannot refresh.
    }
  }, []);

  useEffect(() => {
    if (step === 4 && integrationChoice === "configure") void refreshIntegrations();
  }, [integrationChoice, refreshIntegrations, step]);

  function selectTheme(color: ThemeColor) {
    setThemeColor(color);
    document.documentElement.dataset.theme = color;
  }

  async function createAdministrator() {
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
          displayName: displayName.trim() || undefined,
          instanceName: instanceName.trim() || "PolySIEM",
          themeColor,
        }),
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<unknown> | null;
      if (!response.ok) {
        setError(body?.error?.message ?? "Installer could not create the administrator");
        return;
      }
      setPassword("");
      setConfirm("");
      setStep(3);
    } catch {
      setError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }

  async function updateInstaller(input: Record<string, unknown>): Promise<boolean> {
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/setup", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<unknown> | null;
      if (!response.ok) {
        setError(body?.error?.message ?? "Installer could not save progress");
        return false;
      }
      return true;
    } catch {
      setError("Could not reach the server");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function showTutorial() {
    if (!(await updateInstaller({ action: "set_stage", stage: "tutorial" }))) return;
    setTourSlide(0);
    setStep(5);
  }

  async function saveAiChoice(enabled: boolean, configureNow: boolean) {
    if (
      !(await updateInstaller({
        action: "set_ai",
        enabled,
        configureNow,
      }))
    ) {
      return;
    }
    if (enabled && configureNow) {
      setAiChoice("configure");
      return;
    }
    setStep(4);
  }

  async function continueAfterAiConfiguration() {
    if (!(await updateInstaller({ action: "set_stage", stage: "integrations" }))) {
      return;
    }
    setStep(4);
  }

  async function finishInstaller(tutorialSkipped: boolean) {
    if (!(await updateInstaller({ action: "complete", tutorialSkipped }))) return;
    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4 py-8">
      <div className="w-full max-w-5xl space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 ring-1 ring-primary-foreground/20">
            <AppLogo className="size-8" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Install PolySIEM</h1>
          <p className="text-sm text-muted-foreground">
            Create the first administrator and get oriented before entering your lab
          </p>
        </div>

        <SetupProgress step={step} />

        <Card
          className={cn(
            "mx-auto",
            setupCardWidth(step),
          )}
        >
          {showSetupStep(activeSteps[0], <WelcomeStep onBegin={() => setStep(1)} />)}

          {showSetupStep(activeSteps[1], (
            <AdministratorStep
              username={username}
              displayName={displayName}
              password={password}
              confirmation={confirm}
              error={error}
              onUsernameChange={setUsername}
              onDisplayNameChange={setDisplayName}
              onPasswordChange={setPassword}
              onConfirmationChange={setConfirm}
              onBack={() => setStep(0)}
              onContinue={() => {
                const validationError = validateAdministrator(username, password, confirm);
                if (validationError) {
                  setError(validationError);
                  return;
                }
                setError(null);
                setStep(2);
              }}
            />
          ))}

          {showSetupStep(activeSteps[2], (
            <PreferencesStep
              instanceName={instanceName}
              themeColor={themeColor}
              error={error}
              loading={loading}
              onInstanceNameChange={setInstanceName}
              onThemeChange={selectTheme}
              onBack={() => setStep(1)}
              onCreate={() => void createAdministrator()}
            />
          ))}

          {showSetupStep(activeSteps[3], (
            <>
              {aiChoice === "ask-enable" && (
                <>
                  <CardHeader>
                    <CardTitle>Enable the AI assistant?</CardTitle>
                    <CardDescription>
                      AI features are optional. When disabled, PolySIEM hides the
                      assistant launcher and AI actions.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setAiChoice("ask-configure")}
                        className="rounded-lg border p-5 text-left transition-colors hover:border-primary hover:bg-primary/5"
                      >
                        <Sparkles className="mb-3 size-6 text-primary" />
                        <span className="block font-medium">Enable AI</span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          Use local Ollama or a hosted provider for chat,
                          documentation, and investigations.
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void saveAiChoice(false, false)}
                        className="rounded-lg border p-5 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-50"
                      >
                        <SkipForward className="mb-3 size-6 text-muted-foreground" />
                        <span className="block font-medium">Not now</span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          Keep AI disabled. You can enable it later under Settings.
                        </span>
                      </button>
                    </div>
                    {error && (
                      <p role="alert" className="text-sm font-medium text-destructive">
                        {error}
                      </p>
                    )}
                  </CardContent>
                </>
              )}

              {aiChoice === "ask-configure" && (
                <>
                  <CardHeader>
                    <CardTitle>Configure AI now?</CardTitle>
                    <CardDescription>
                      Connect a provider now, or enable the assistant and fill in
                      provider details later.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void saveAiChoice(true, true)}
                        className="rounded-lg border p-5 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-50"
                      >
                        <PlugZap className="mb-3 size-6 text-primary" />
                        <span className="block font-medium">Configure now</span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          Choose Ollama, OpenAI, DeepSeek, Anthropic, or Azure OpenAI.
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void saveAiChoice(true, false)}
                        className="rounded-lg border p-5 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-50"
                      >
                        <SkipForward className="mb-3 size-6 text-primary" />
                        <span className="block font-medium">Configure later</span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          Enable the assistant now and configure its provider in Settings.
                        </span>
                      </button>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setAiChoice("ask-enable")}
                      disabled={loading}
                    >
                      <ArrowLeft className="size-4" /> Back
                    </Button>
                    {error && (
                      <p role="alert" className="text-sm font-medium text-destructive">
                        {error}
                      </p>
                    )}
                  </CardContent>
                </>
              )}

              {aiChoice === "configure" && (
                <CardContent className="space-y-4 p-0">
                  <AiSettingsForm
                    initialConfig={{ ...initialAiConfig, enabled: true }}
                    onSaved={() => void continueAfterAiConfiguration()}
                    className="border-0 shadow-none"
                  />
                  {error && (
                    <p
                      role="alert"
                      className="px-6 pb-2 text-sm font-medium text-destructive"
                    >
                      {error}
                    </p>
                  )}
                  <div className="flex justify-between border-t px-6 py-4">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setAiChoice("ask-configure")}
                      disabled={loading}
                    >
                      <ArrowLeft className="size-4" /> Back
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void continueAfterAiConfiguration()}
                      disabled={loading}
                    >
                      Configure later <ArrowRight className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              )}
            </>
          ))}

          {showSetupStep(activeSteps[4], (
            <>
              <CardHeader>
                <CardTitle>Connect integrations?</CardTitle>
                <CardDescription>
                  Integrations are optional. Add them now, or continue and configure them later in Settings.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {integrationChoice === "ask" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setIntegrationChoice("configure")}
                      className="rounded-lg border p-5 text-left transition-colors hover:border-primary hover:bg-primary/5"
                    >
                      <PlugZap className="mb-3 size-6 text-primary" />
                      <span className="block font-medium">Set up integrations now</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        Connect Proxmox, OPNsense, UniFi, Elasticsearch, or OTX.
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={showTutorial}
                      className="rounded-lg border p-5 text-left transition-colors hover:border-primary hover:bg-primary/5"
                    >
                      <SkipForward className="mb-3 size-6 text-primary" />
                      <span className="block font-medium">Do this later</span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        Continue to the dashboard tutorial without adding a source.
                      </span>
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      {integrations.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
                          No integrations added yet. You can add one or continue without any.
                        </div>
                      ) : (
                        integrations.map((integration) => {
                          const meta = INTEGRATION_TYPE_META[integration.type];
                          const Icon = meta.icon;
                          return (
                            <div key={integration.id} className="flex items-center gap-3 rounded-lg border p-3">
                              <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                                <Icon className="size-4" />
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{integration.name}</p>
                                <p className="text-xs text-muted-foreground">{meta.label}</p>
                              </div>
                              <Check className="ml-auto size-4 text-emerald-600" />
                            </div>
                          );
                        })
                      )}
                    </div>
                    <Button type="button" variant="outline" onClick={() => setIntegrationDialogOpen(true)}>
                      <Plus className="size-4" /> Add integration
                    </Button>
                    <div className="flex items-center justify-between border-t pt-4">
                      <Button type="button" variant="ghost" onClick={() => setIntegrationChoice("ask")}>
                        <ArrowLeft className="size-4" /> Back
                      </Button>
                      <Button type="button" onClick={showTutorial} disabled={loading}>
                        {loading && <Loader2 className="size-4 animate-spin" />}
                        Continue to tutorial <ArrowRight className="size-4" />
                      </Button>
                    </div>
                  </>
                )}
                {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
              </CardContent>
            </>
          ))}

          {showSetupStep(activeSteps[5], (
            <>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle>Meet your dashboard</CardTitle>
                  <CardDescription>
                    This is an isolated mock preview. It does not add demo records to your installation.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loading}
                  onClick={() => finishInstaller(true)}
                >
                  Skip tutorial
                </Button>
              </CardHeader>
              <CardContent className="space-y-5">
                <DashboardTutorialPreview slide={tourSlide} />
                {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
                <div className="flex items-center justify-between">
                  <div className="flex gap-1.5" aria-label="Tutorial progress">
                    {DASHBOARD_TOUR_SLIDES.map((slide, index) => (
                      <button
                        key={slide.title}
                        type="button"
                        aria-label={`Show tutorial step ${index + 1}`}
                        onClick={() => setTourSlide(index)}
                        className={cn(
                          "h-2 rounded-full transition-all",
                          index === tourSlide ? "w-6 bg-primary" : "w-2 bg-border",
                        )}
                      />
                    ))}
                  </div>
                  {tourSlide < DASHBOARD_TOUR_SLIDES.length - 1 ? (
                    <Button type="button" onClick={() => setTourSlide((current) => current + 1)}>
                      Next <ArrowRight className="size-4" />
                    </Button>
                  ) : (
                    <Button type="button" onClick={() => finishInstaller(false)} disabled={loading}>
                      {loading && <Loader2 className="size-4 animate-spin" />}
                      Finish installation
                    </Button>
                  )}
                </div>
              </CardContent>
            </>
          ))}
        </Card>
      </div>

      <IntegrationFormDialog
        open={integrationDialogOpen}
        onOpenChange={(open) => {
          setIntegrationDialogOpen(open);
          if (!open) void refreshIntegrations();
        }}
        integration={null}
        mockIntegrationsEnabled={false}
      />
    </main>
  );
}
