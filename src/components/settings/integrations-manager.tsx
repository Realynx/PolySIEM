"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { replaceWithNavigationFeedback } from "@/components/shell/navigation-feedback";
import { useMutation } from "@tanstack/react-query";
import {
  FlaskConical,
  Loader2,
  Plug,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_LAB_SIZE,
  LAB_SIZE_PRESETS,
  type LabSize,
} from "@/lib/demo/catalog";
import {
  DEFAULT_MOCK_SCENARIO_PROFILE,
  DEFAULT_MOCK_SCENARIO_SEED,
  MAX_MOCK_SCENARIO_SEED_LENGTH,
  MOCK_SCENARIO_PROFILES,
  normalizeMockScenarioSeed,
  type MockScenarioProfile,
} from "@/lib/integrations/mock-url";
import type { IntegrationTypeValue } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/components/shared/api-client";
import { IntegrationFormDialog } from "./integration-form-dialog";
import { IntegrationCard } from "./integration-card";

import {
  INTEGRATION_TYPE_META,
  type DeveloperModeView,
  type IntegrationView,
} from "./integration-types";

export { INTEGRATION_TYPE_META };
export type { DeveloperModeView, IntegrationView };


interface SettingsPatchResponse {
  purgedMockIntegrations: number;
}

interface DemoProvisionResponse {
  created: string[];
  reused: string[];
  removed: string[];
  syncRuns: Array<{ integrationId: string; runId: string }>;
}

export function IntegrationsManager({
  integrations,
  developerMode,
  initialAddType = null,
  initialEditId = null,
  initialCredentialUpgrade = null,
}: {
  integrations: IntegrationView[];
  developerMode: DeveloperModeView;
  initialAddType?: IntegrationTypeValue | null;
  initialEditId?: string | null;
  initialCredentialUpgrade?: "cloudflare-routes" | null;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(initialAddType !== null);
  const [editTarget, setEditTarget] = useState<IntegrationView | null>(() =>
    integrations.find((integration) => integration.id === initialEditId) ?? null,
  );
  const [deleteTarget, setDeleteTarget] = useState<IntegrationView | null>(null);
  const [purge, setPurge] = useState(false);
  const [demoProfile, setDemoProfile] = useState<MockScenarioProfile>(
    DEFAULT_MOCK_SCENARIO_PROFILE,
  );
  const [demoSeed, setDemoSeed] = useState(DEFAULT_MOCK_SCENARIO_SEED);
  const [demoSize, setDemoSize] = useState<LabSize>(DEFAULT_LAB_SIZE);
  const [disableMocksTarget, setDisableMocksTarget] =
    useState<DeveloperModeView | null>(null);
  const saveDeveloperMode = useMutation({
    mutationFn: (next: DeveloperModeView) =>
      apiFetch<SettingsPatchResponse>("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ developerMode: next }),
      }),
    onSuccess: (result) => {
      toast.success(
        "Developer settings saved",
        result.purgedMockIntegrations > 0
          ? {
              description: `Removed ${result.purgedMockIntegrations} mock integrations and their generated data.`,
            }
          : undefined,
      );
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const mockIntegrationsEnabled =
    developerMode.enabled && developerMode.features.mockIntegrations;
  const mockIntegrationCount = integrations.filter((integration) =>
    integration.baseUrl.toLowerCase().startsWith("mock://"),
  ).length;

  /**
   * Switching mocks off deletes their generated data, so confirm first whenever
   * there is something to lose.
   */
  const applyDeveloperMode = (next: DeveloperModeView) => {
    const willDisableMocks =
      mockIntegrationsEnabled && !(next.enabled && next.features.mockIntegrations);
    if (willDisableMocks && mockIntegrationCount > 0) {
      setDisableMocksTarget(next);
      return;
    }
    saveDeveloperMode.mutate(next);
  };
  const provisionDemo = useMutation({
    mutationFn: () =>
      apiFetch<DemoProvisionResponse>("/api/admin/developer/demo-environment", {
        method: "POST",
        body: JSON.stringify({
          profile: demoProfile,
          seed: normalizeMockScenarioSeed(demoSeed),
          size: demoSize,
        }),
      }),
    onSuccess: (result) => {
      toast.success(
        result.created.length > 0
          ? `Installed ${result.created.length} mock integrations`
          : `Refreshed ${result.reused.length} mock integrations`,
        result.removed.length > 0
          ? { description: `Removed ${result.removed.length} other mock integrations and their generated data.` }
          : undefined,
      );
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteIntegration = useMutation({
    mutationFn: (input: { id: string; purge: boolean }) =>
      apiFetch(`/api/admin/integrations/${input.id}${input.purge ? "?purge=true" : ""}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success(`Deleted ${deleteTarget?.name}`);
      setDeleteTarget(null);
      setPurge(false);
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Connect compute, network, security, logging, and edge providers to build one continuously maintained picture of the lab."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> Add integration
          </Button>
        }
      />

      <Card className="mb-6 border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="size-4 text-muted-foreground" />
            Developer mode
          </CardTitle>
          <CardDescription>
            Enable opt-in development features for demos and UI testing. Live integrations are unaffected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Enable developer features</p>
              <p className="text-xs text-muted-foreground">
                Keeps experimental controls hidden during normal operation.
              </p>
            </div>
            <Switch
              checked={developerMode.enabled}
              disabled={saveDeveloperMode.isPending}
              onCheckedChange={(enabled) =>
                applyDeveloperMode({ ...developerMode, enabled })
              }
              aria-label="Enable developer features"
            />
          </div>
          {developerMode.enabled && (
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Mock integrations</p>
                <p className="text-xs text-muted-foreground">
                  Add offline demo sources backed by generated fixture data instead of remote systems.
                </p>
              </div>
              <Switch
                checked={developerMode.features.mockIntegrations}
                disabled={saveDeveloperMode.isPending}
                onCheckedChange={(mockIntegrations) =>
                  applyDeveloperMode({
                    ...developerMode,
                    features: { ...developerMode.features, mockIntegrations },
                  })
                }
                aria-label="Enable mock integrations"
              />
            </div>
          )}
          {mockIntegrationsEnabled && (
            <div className="space-y-3 rounded-md border border-dashed p-3">
              <div>
                <p className="text-sm font-medium">Complete mock lab</p>
                <p className="text-xs text-muted-foreground">
                  Install or refresh a coordinated Proxmox, OPNsense, UniFi, Elasticsearch, and OTX set.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                <div className="grid gap-1.5">
                  <Label htmlFor="demo-profile">Scenario</Label>
                  <Select
                    value={demoProfile}
                    onValueChange={(value) => setDemoProfile(value as MockScenarioProfile)}
                  >
                    <SelectTrigger id="demo-profile">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(MOCK_SCENARIO_PROFILES).map(([value, profile]) => (
                        <SelectItem key={value} value={value}>
                          {profile.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="demo-seed">Stable seed</Label>
                  <Input
                    id="demo-seed"
                    value={demoSeed}
                    maxLength={MAX_MOCK_SCENARIO_SEED_LENGTH}
                    onChange={(event) => setDemoSeed(event.target.value)}
                    onBlur={() => setDemoSeed(normalizeMockScenarioSeed(demoSeed))}
                    className="font-mono"
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={provisionDemo.isPending}
                  onClick={() => provisionDemo.mutate()}
                >
                  {provisionDemo.isPending && <Loader2 className="animate-spin" />}
                  Install or refresh
                </Button>
              </div>
              <div className="grid gap-2 rounded-md bg-muted/40 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="demo-size">Lab size</Label>
                  <span className="text-xs font-medium text-foreground">
                    {LAB_SIZE_PRESETS[demoSize].label} · {Math.round(LAB_SIZE_PRESETS[demoSize].scale * 100)}%
                  </span>
                </div>
                <Slider
                  id="demo-size"
                  min={1}
                  max={5}
                  step={1}
                  value={[demoSize]}
                  onValueChange={(values) => {
                    const next = values[0];
                    if (next && next in LAB_SIZE_PRESETS) setDemoSize(next as LabSize);
                  }}
                  aria-label="Mock lab size"
                />
                <div aria-hidden className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Tiny</span>
                  <span>Medium</span>
                  <span>Extra large</span>
                </div>
                <p className="text-xs text-muted-foreground">{LAB_SIZE_PRESETS[demoSize].description}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {MOCK_SCENARIO_PROFILES[demoProfile].description} The selected scenario and size become the
                only mock integration set; previous mock sets are removed. Live integrations are never changed.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {integrations.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No integrations yet"
          description="Add a supported platform or Edge NAT server to start syncing inventory and network evidence."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" /> Add integration
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {integrations.map((integration) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              onEdit={() => setEditTarget(integration)}
              onDelete={() => setDeleteTarget(integration)}
            />
          ))}
        </div>
      )}

      <IntegrationFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        integration={null}
        mockIntegrationsEnabled={mockIntegrationsEnabled}
        initialType={initialAddType}
      />
      <IntegrationFormDialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null);
            if (initialEditId) {
              replaceWithNavigationFeedback(router, "/settings/integrations");
            }
          }
        }}
        integration={editTarget}
        mockIntegrationsEnabled={mockIntegrationsEnabled}
        credentialUpgrade={editTarget?.id === initialEditId ? initialCredentialUpgrade : null}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setPurge(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The connection and its credentials are removed. Synced inventory is kept unless you also
              remove it below.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <Checkbox checked={purge} onCheckedChange={(v) => setPurge(v === true)} className="mt-0.5" />
            <span>
              <span className="font-medium">Also remove synced data</span>
              <span className="block text-muted-foreground">
                Deletes every host, VM, network, rule, and lease this integration created.
              </span>
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteIntegration.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteIntegration.mutate({ id: deleteTarget.id, purge });
              }}
            >
              {deleteIntegration.isPending && <Loader2 className="animate-spin" />}
              Delete integration
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={disableMocksTarget !== null}
        onOpenChange={(open) => !open && setDisableMocksTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off mock integrations?</AlertDialogTitle>
            <AlertDialogDescription>
              The {mockIntegrationCount} mock{" "}
              {mockIntegrationCount === 1 ? "integration" : "integrations"} and every host, VM,
              network, rule, and lease they generated will be deleted. Your live integrations are
              not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={saveDeveloperMode.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (disableMocksTarget) {
                  saveDeveloperMode.mutate(disableMocksTarget, {
                    onSettled: () => setDisableMocksTarget(null),
                  });
                }
              }}
            >
              {saveDeveloperMode.isPending && <Loader2 className="animate-spin" />}
              Turn off and delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
