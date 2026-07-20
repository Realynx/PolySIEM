"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Pencil, Plug, PlugZap, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { isLiveQueryType, type IntegrationTypeValue } from "@/lib/types";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/components/shared/api-client";
import { SyncStatusBadge } from "@/components/shared/badges";
import {
  INTEGRATION_TYPE_META,
  type IntegrationView,
} from "@/components/settings/integrations-manager";
import { IntegrationFormDialog } from "@/components/settings/integration-form-dialog";
import { SyncNowButton } from "@/components/integrations-sync/sync-now-button";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileFab } from "@/components/mobile/ui/mobile-fab";
import {
  MobileEmpty,
  MobileKeyRow,
  MobileList,
  MobileListRow,
} from "@/components/mobile/ui/mobile-list";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";

/** Compact endpoint text, mirroring the desktop card's display rule. */
function displayEndpoint(baseUrl: string): string {
  if (baseUrl.startsWith("mock://")) return baseUrl.replace("mock://", "mock · ");
  try {
    const url = new URL(baseUrl);
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return `${url.host}${path}`;
  } catch {
    return baseUrl;
  }
}

/**
 * Phone integrations management: rows into a per-integration sheet with the
 * card actions (toggle, test, sync, edit, delete) and a FAB that opens the
 * shared `IntegrationFormDialog`. Developer-mode / mock-lab provisioning stays
 * a desktop-only surface.
 */
export function MobileIntegrationsSettingsPage({
  integrations,
  mockIntegrationsEnabled,
  initialAddType = null,
  initialEditId = null,
}: {
  integrations: IntegrationView[];
  mockIntegrationsEnabled: boolean;
  initialAddType?: IntegrationTypeValue | null;
  initialEditId?: string | null;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(initialAddType !== null);
  const [targetId, setTargetId] = useState<string | null>(initialEditId);
  const [editTarget, setEditTarget] = useState<IntegrationView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IntegrationView | null>(null);
  const [purge, setPurge] = useState(false);
  const target = integrations.find((i) => i.id === targetId) ?? null;

  const deleteIntegration = useMutation({
    mutationFn: (input: { id: string; purge: boolean }) =>
      apiFetch(`/api/admin/integrations/${input.id}${input.purge ? "?purge=true" : ""}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success(`Deleted ${deleteTarget?.name}`);
      setDeleteTarget(null);
      setPurge(false);
      setTargetId(null);
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <MobilePageHeader title="Integrations" backHref="/settings" />
      <MobilePage>
        {integrations.length === 0 ? (
          <MobileEmpty
            icon={<Plug />}
            title="No integrations yet"
            description="Add a supported platform or Edge NAT server to start syncing inventory and network evidence."
          />
        ) : (
          <MobileList>
            {integrations.map((integration) => {
              const meta = INTEGRATION_TYPE_META[integration.type];
              return (
                <MobileListRow
                  key={integration.id}
                  onClick={() => setTargetId(integration.id)}
                  className={!integration.enabled ? "opacity-60" : undefined}
                  leading={
                    <span
                      className={cn(
                        "flex size-9 items-center justify-center rounded-xl",
                        meta.iconTone,
                      )}
                    >
                      <meta.icon className="size-4.5" />
                    </span>
                  }
                  title={
                    <>
                      <span className="truncate">{integration.name}</span>
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          integration.enabled ? "bg-emerald-500" : "bg-muted-foreground/50",
                        )}
                        aria-label={integration.enabled ? "Enabled" : "Disabled"}
                      />
                    </>
                  }
                  subtitle={`${meta.label} · ${displayEndpoint(integration.baseUrl)}`}
                  trailing={
                    integration.lastSyncStatus ? (
                      <SyncStatusBadge status={integration.lastSyncStatus} />
                    ) : isLiveQueryType(integration.type) ? (
                      "on demand"
                    ) : (
                      "not synced"
                    )
                  }
                />
              );
            })}
          </MobileList>
        )}
        <p className="px-0.5 text-xs text-muted-foreground">
          Developer mode and mock-lab provisioning are available on the desktop view.
        </p>
      </MobilePage>

      <MobileFab aria-label="Add integration" onClick={() => setAddOpen(true)}>
        <Plus />
      </MobileFab>

      <IntegrationDetailSheet
        integration={target}
        onClose={() => setTargetId(null)}
        onEdit={() => target && setEditTarget(target)}
        onDelete={() => target && setDeleteTarget(target)}
      />

      <IntegrationFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        integration={null}
        mockIntegrationsEnabled={mockIntegrationsEnabled}
        initialType={initialAddType}
      />
      <IntegrationFormDialog
        open={editTarget !== null}
        onOpenChange={(open) => !open && setEditTarget(null)}
        integration={editTarget}
        mockIntegrationsEnabled={mockIntegrationsEnabled}
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
              The connection and its credentials are removed. Synced inventory is kept unless you
              also remove it below.
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
    </>
  );
}

function IntegrationDetailSheet({
  integration,
  onClose,
  onEdit,
  onDelete,
}: {
  integration: IntegrationView | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();

  const toggleEnabled = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch(`/api/admin/integrations/${integration!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: (_data, enabled) => {
      toast.success(`${integration?.name} ${enabled ? "enabled" : "disabled"}`);
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const testConnection = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; detail: string }>(
        `/api/admin/integrations/${integration!.id}/test`,
        { method: "POST" },
      ),
    onSuccess: (data) => {
      if (data.ok) toast.success(data.detail || "Connection successful");
      else toast.error(`Connection test failed: ${data.detail}`);
    },
    onError: (err: Error) => toast.error(`Connection test failed: ${err.message}`),
  });

  const meta = integration ? INTEGRATION_TYPE_META[integration.type] : null;
  const live = integration ? isLiveQueryType(integration.type) : false;

  return (
    <BottomSheet
      open={integration !== null}
      onOpenChange={(open) => !open && onClose()}
      title={integration?.name ?? ""}
      description={meta?.label}
    >
      {integration && (
        <div className="flex flex-col gap-4 pt-1">
          <div className="divide-y divide-border/60 rounded-xl border bg-card">
            <div className="flex min-h-11 items-center justify-between gap-4 px-3.5 py-2">
              <span className="text-xs text-muted-foreground">Enabled</span>
              <Switch
                checked={integration.enabled}
                disabled={toggleEnabled.isPending}
                onCheckedChange={(v) => toggleEnabled.mutate(v)}
                aria-label={`Enable ${integration.name}`}
              />
            </div>
            <MobileKeyRow label="Endpoint" mono>
              {displayEndpoint(integration.baseUrl)}
            </MobileKeyRow>
            <MobileKeyRow label="Transport">
              {integration.verifyTls ? "TLS verified" : "TLS checks off"}
            </MobileKeyRow>
            <MobileKeyRow label="Updates">
              {live ? "On demand" : `Every ${integration.syncIntervalMinutes}m`}
            </MobileKeyRow>
            <MobileKeyRow label="Last sync">
              {integration.lastSyncAt ? formatRelative(integration.lastSyncAt) : "never"}
            </MobileKeyRow>
          </div>

          {integration.lastSyncError && (
            <p className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs break-words text-destructive">
              {integration.lastSyncError}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 [&_button]:w-full">
            <Button
              variant="outline"
              size="sm"
              disabled={testConnection.isPending}
              onClick={() => testConnection.mutate()}
            >
              <PlugZap className="size-4" /> {testConnection.isPending ? "Testing…" : "Test"}
            </Button>
            {!live && <SyncNowButton integrationId={integration.id} name={integration.name} />}
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="size-4" /> Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onDelete}
            >
              Delete
            </Button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
