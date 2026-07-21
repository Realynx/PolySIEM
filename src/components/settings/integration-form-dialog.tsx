"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  buildMockIntegrationUrl,
  DEFAULT_MOCK_SCENARIO_SEED,
  MAX_MOCK_SCENARIO_SEED_LENGTH,
  MOCK_SCENARIO_PROFILES,
  normalizeMockScenarioSeed,
  type MockScenarioProfile,
} from "@/lib/integrations/mock-url";
import { isLiveQueryType, type IntegrationTypeValue } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/components/shared/api-client";
import { getElasticsearchEndpointIssue } from "@/lib/integrations/elasticsearch/endpoint";
import type { IntegrationView } from "./integrations-manager";
import {
  buildIntegrationPayload,
  credentialsFilled,
  emptyForm,
  formForType,
  type FormState,
} from "./integration-form-model";

import {
  INTEGRATION_FORM_META,
  IntegrationPicker,
} from "./integration-form-presentation";
import { IntegrationSpecificFields } from "./integration-form-fields";

export function IntegrationFormDialog({
  open,
  onOpenChange,
  integration,
  mockIntegrationsEnabled,
  initialType = null,
  credentialUpgrade = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integration: IntegrationView | null;
  mockIntegrationsEnabled: boolean;
  initialType?: IntegrationTypeValue | null;
  credentialUpgrade?: "cloudflare-routes" | null;
}) {
  const router = useRouter();
  const isEdit = integration !== null;
  const [form, setForm] = useState<FormState>(() => emptyForm(integration));
  const [replaceCredentials, setReplaceCredentials] = useState(false);
  const [selectingType, setSelectingType] = useState(integration === null && initialType === null);
  const usingMock = form.baseUrl.trim().toLowerCase().startsWith("mock://");
  const elasticsearchEndpointIssue =
    form.type === "ELASTICSEARCH" && !usingMock
      ? getElasticsearchEndpointIssue(form.baseUrl)
      : null;
  const formMeta = INTEGRATION_FORM_META[form.type];
  const originalUsesMock =
    integration?.baseUrl.trim().toLowerCase().startsWith("mock://") === true;
  const changingMockToLive = isEdit && originalUsesMock && !usingMock;
  // Re-seed the form whenever the dialog opens for a (different) target.
  useEffect(() => {
    if (open) {
      setForm(integration ? emptyForm(integration) : formForType(initialType));
      setReplaceCredentials(credentialUpgrade === "cloudflare-routes" && integration?.type === "CLOUDFLARE");
      setSelectingType(integration === null && initialType === null);
    }
  }, [open, integration, initialType, credentialUpgrade]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setMockOptions(profile: MockScenarioProfile, seed: string) {
    const rawSeed = seed.slice(0, MAX_MOCK_SCENARIO_SEED_LENGTH);
    setForm((current) => ({
      ...current,
      mockProfile: profile,
      mockSeed: rawSeed,
      baseUrl: buildMockIntegrationUrl(profile, rawSeed),
    }));
  }

  const save = useMutation({
    mutationFn: () => {
      const body = buildIntegrationPayload(form, {
        isEdit,
        includeCredentials: replaceCredentials || changingMockToLive,
        usingMock,
      });
      if (isEdit) {
        return apiFetch(`/api/admin/integrations/${integration.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      return apiFetch("/api/admin/integrations", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => {
      toast.success(isEdit ? `Updated ${form.name}` : `Added ${form.name}`);
      onOpenChange(false);
      if (!isEdit && form.type === "EDGE_NAT_SERVER") {
        router.push("/network/edge-networks");
      } else {
        router.refresh();
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (elasticsearchEndpointIssue) {
      toast.error(elasticsearchEndpointIssue);
      return;
    }
    if ((!isEdit || changingMockToLive) && !usingMock && !credentialsFilled(form)) {
      toast.error("Please fill in the credentials");
      return;
    }
    save.mutate();
  }

  const showCredentials =
    (!isEdit || replaceCredentials || changingMockToLive) && !usingMock && form.type !== "EDGE_NAT_SERVER";

  function selectIntegration(type: IntegrationTypeValue) {
    setForm(formForType(type));
    setSelectingType(false);
  }

  if (!isEdit && selectingType) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[calc(100svh-1rem)] overflow-y-auto sm:max-h-[90svh] sm:max-w-3xl">
          <IntegrationPicker
            onSelect={selectIntegration}
            onCancel={() => onOpenChange(false)}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100svh-1rem)] flex-col overflow-hidden sm:max-h-[90svh] sm:max-w-2xl">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <DialogHeader className="shrink-0 pr-8">
            {!isEdit && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 mb-1 w-fit text-muted-foreground"
                onClick={() => setSelectingType(true)}
              >
                <ArrowLeft /> All integrations
              </Button>
            )}
            <DialogTitle>
              {isEdit
                ? `Edit ${integration.name}`
                : `Connect ${formMeta.label}`}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Update connection details. Credentials stay unchanged unless you replace them."
                : formMeta.description}
            </DialogDescription>
          </DialogHeader>

          <div className="-mr-2 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain py-4 pr-2">
            {!isEdit && !usingMock && (
              <div className="flex items-start gap-3 rounded-lg bg-primary/5 p-3 ring-1 ring-primary/15">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <ShieldCheck className="size-4" />
                </span>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{formMeta.summaryTitle}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {formMeta.summary}
                  </p>
                </div>
              </div>
            )}

            {isEdit && form.type === "CLOUDFLARE" && credentialUpgrade === "cloudflare-routes" && (
              <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Upgrade this token for published-route management</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    In Cloudflare, either edit the current token or create a Custom Token with
                    <strong> Account → Cloudflare Tunnel → Edit</strong> and
                    <strong> Zone → Zone → Read</strong>, and
                    <strong> Zone → DNS → Edit</strong>, scoped to this account and the zones PolySIEM may publish.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" asChild>
                    <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">
                      Open Cloudflare API Tokens <ExternalLink />
                    </a>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Editing the existing token normally keeps the stored secret, so you can close this dialog and retry the route. If you create a replacement token, paste it below and save.
                </p>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="int-name">Name</Label>
              <Input
                id="int-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={formMeta.namePlaceholder}
                required
                maxLength={64}
              />
            </div>
            {mockIntegrationsEnabled && form.type !== "CLOUDFLARE" && form.type !== "TAILSCALE" && form.type !== "EDGE_NAT_SERVER" && form.type !== "CENSYS" && form.type !== "SECURITYTRAILS" && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-dashed p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="int-mock">Use generated mock data</Label>
                  <p className="text-xs text-muted-foreground">
                    Runs completely offline and does not contact a remote system or require credentials.
                  </p>
                </div>
                <Switch
                  id="int-mock"
                  checked={usingMock}
                  onCheckedChange={(enabled) => {
                    if (enabled) {
                      setForm((current) => ({
                        ...current,
                        baseUrl: buildMockIntegrationUrl(
                          current.mockProfile,
                          current.mockSeed,
                        ),
                        verifyTls: false,
                      }));
                    } else {
                      set("baseUrl", "");
                    }
                  }}
                />
              </div>
            )}
            {mockIntegrationsEnabled && usingMock && (
              <div className="space-y-4 rounded-md border border-dashed p-3">
                <div className="grid gap-2">
                  <Label htmlFor="int-mock-profile">Scenario profile</Label>
                  <Select
                    value={form.mockProfile}
                    onValueChange={(value) =>
                      setMockOptions(value as MockScenarioProfile, form.mockSeed)
                    }
                  >
                    <SelectTrigger id="int-mock-profile">
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
                  <p className="text-xs text-muted-foreground">
                    {MOCK_SCENARIO_PROFILES[form.mockProfile].description}
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="int-mock-seed">Stable seed</Label>
                  <Input
                    id="int-mock-seed"
                    value={form.mockSeed}
                    maxLength={MAX_MOCK_SCENARIO_SEED_LENGTH}
                    onChange={(event) =>
                      setMockOptions(form.mockProfile, event.target.value)
                    }
                    onBlur={() =>
                      setMockOptions(
                        form.mockProfile,
                        normalizeMockScenarioSeed(form.mockSeed),
                      )
                    }
                    placeholder={DEFAULT_MOCK_SCENARIO_SEED}
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Reusing the same profile and seed produces the same inventory and event identities. Use
                    the pair across related mock integrations to keep one coherent lab.
                  </p>
                </div>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="int-url">{formMeta.urlLabel}</Label>
              <Input
                id="int-url"
                value={form.baseUrl}
                onChange={(e) => set("baseUrl", e.target.value)}
                placeholder={formMeta.urlPlaceholder}
                required
                disabled={mockIntegrationsEnabled && usingMock}
              />
              {!usingMock && (
                <p className="text-xs text-muted-foreground">
                  {formMeta.urlHint}
                </p>
              )}
              {elasticsearchEndpointIssue && (
                <p className="text-xs text-destructive">
                  {elasticsearchEndpointIssue}
                </p>
              )}
              {usingMock && mockIntegrationsEnabled && (
                <p className="text-xs text-muted-foreground">
                  This saved integration uses the offline mock driver.
                </p>
              )}
              {usingMock && !mockIntegrationsEnabled && (
                <p className="text-xs text-destructive">
                  Mock integrations are turned off, so this one can no longer be saved as-is. Point it
                  at a real system, or delete it from the integrations list.
                </p>
              )}
            </div>
            {form.type !== "EDGE_NAT_SERVER" && <div className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="int-tls">Verify TLS certificate</Label>
                <p className="text-xs text-muted-foreground">
                  {form.type === "PROXMOX"
                    ? "Turn this off if the node still uses Proxmox's default self-signed certificate."
                    : "Turn this off only if the service uses a self-signed certificate."}
                </p>
              </div>
              <Switch
                id="int-tls"
                checked={form.verifyTls}
                disabled={usingMock}
                onCheckedChange={(v) => set("verifyTls", v)}
              />
            </div>}
            {!isLiveQueryType(form.type) && (
              <div className="grid gap-2">
                <Label htmlFor="int-interval">Sync interval (minutes)</Label>
                <Input
                  id="int-interval"
                  type="number"
                  min={1}
                  max={1440}
                  value={form.syncIntervalMinutes}
                  onChange={(e) => set("syncIntervalMinutes", e.target.value)}
                  className="max-w-32"
                />
              </div>
            )}

            {isEdit && form.type !== "EDGE_NAT_SERVER" && (
              <Collapsible open={replaceCredentials} onOpenChange={setReplaceCredentials}>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5">
                    Replace credentials
                    <ChevronDown
                      className={cn("size-4 transition-transform", replaceCredentials && "rotate-180")}
                    />
                  </Button>
                </CollapsibleTrigger>
              </Collapsible>
            )}

            <IntegrationSpecificFields
              form={form}
              setForm={setForm}
              set={set}
              isEdit={isEdit}
              showCredentials={showCredentials}
            />
          </div>

          <DialogFooter className="relative z-10 shrink-0 bg-popover/95 backdrop-blur supports-backdrop-filter:bg-popover/85">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : isEdit ? "Save changes" : "Add integration"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
