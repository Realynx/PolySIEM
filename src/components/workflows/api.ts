"use client";

/**
 * Typed react-query hooks over the frozen workflow API contract
 * (src/lib/workflows/types.ts). All endpoints are implemented by the engine
 * side; consumers must handle loading/error states — the engine may not be
 * deployed yet, in which case these return 404s.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/components/shared/api-client";
import type {
  NodeTypeMeta,
  WorkflowDto,
  WorkflowRunDto,
} from "@/lib/workflows/types";

export const wfKeys = {
  catalog: ["workflow-catalog"] as const,
  list: ["workflows"] as const,
  detail: (id: string) => ["workflows", id] as const,
  workflowRuns: (id: string) => ["workflow-runs", id] as const,
  globalRuns: ["workflow-runs", "__global__"] as const,
  run: (runId: string) => ["workflow-run", runId] as const,
};

export function useCatalog() {
  return useQuery({
    queryKey: wfKeys.catalog,
    queryFn: () => apiFetch<NodeTypeMeta[]>("/api/workflows/catalog"),
    staleTime: 5 * 60_000,
  });
}

export function useWorkflows() {
  return useQuery({
    queryKey: wfKeys.list,
    queryFn: () => apiFetch<WorkflowDto[]>("/api/workflows"),
  });
}

export function useWorkflow(id: string) {
  return useQuery({
    queryKey: wfKeys.detail(id),
    queryFn: () => apiFetch<WorkflowDto>(`/api/workflows/${id}`),
  });
}

export function useWorkflowRuns(id: string, enabled = true) {
  return useQuery({
    queryKey: wfKeys.workflowRuns(id),
    queryFn: () => apiFetch<WorkflowRunDto[]>(`/api/workflows/${id}/runs`),
    enabled,
  });
}

export function useGlobalRuns() {
  return useQuery({
    queryKey: wfKeys.globalRuns,
    queryFn: () => apiFetch<WorkflowRunDto[]>("/api/workflows/runs"),
    // Runs execute synchronously in v1, but keep polling while any look live.
    refetchInterval: (query) =>
      query.state.data?.some((r) => r.status === "RUNNING") ? 4000 : false,
  });
}

export function useRunDetail(runId: string | null) {
  return useQuery({
    queryKey: wfKeys.run(runId ?? "none"),
    queryFn: () => apiFetch<WorkflowRunDto>(`/api/workflows/runs/${runId}`),
    enabled: runId !== null,
    // Keep step statuses moving while a run is in flight; stop once it ends.
    refetchInterval: (query) => (query.state.data?.status === "RUNNING" ? 1500 : false),
  });
}

// ---------- entity pickers (existing inventory APIs) ----------

export type EntityKind = "network" | "vm" | "device" | "integration" | "workflow";

export interface EntityOption {
  id: string;
  label: string;
  subtitle: string | null;
}

interface NetworkRow {
  id: string;
  name: string;
  cidr: string | null;
  vlanId: number | null;
}
interface VmRow {
  id: string;
  name: string;
  host: { id: string; name: string } | null;
  powerState?: string;
}
interface DeviceRow {
  id: string;
  name: string;
  kind: string | null;
}
interface IntegrationRow {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
}

const ENTITY_ROUTE: Record<Exclude<EntityKind, "workflow" | "integration">, string> = {
  network: "/api/inventory/networks?pageSize=200",
  vm: "/api/inventory/vms?pageSize=200",
  device: "/api/inventory/hosts?pageSize=200",
};

async function fetchEntityOptions(kind: EntityKind): Promise<EntityOption[]> {
  if (kind === "workflow") {
    const workflows = await apiFetch<WorkflowDto[]>("/api/workflows");
    return workflows.map((w) => ({
      id: w.id,
      label: w.name,
      subtitle: w.enabled ? "enabled" : "disabled",
    }));
  }
  if (kind === "integration") {
    const integrations = await apiFetch<IntegrationRow[]>("/api/admin/integrations");
    return integrations.map((integration) => ({
      id: integration.id,
      label: integration.name,
      subtitle: `${integration.type}${integration.enabled ? "" : " · disabled"}`,
    }));
  }
  const { items } = await apiFetch<{ items: unknown[]; total: number }>(ENTITY_ROUTE[kind]);
  if (kind === "network") {
    return (items as NetworkRow[]).map((n) => ({
      id: n.id,
      label: n.name,
      subtitle: [n.cidr, n.vlanId != null ? `VLAN ${n.vlanId}` : null].filter(Boolean).join(" · ") || null,
    }));
  }
  if (kind === "vm") {
    return (items as VmRow[]).map((v) => ({
      id: v.id,
      label: v.name,
      subtitle: v.host ? `on ${v.host.name}` : null,
    }));
  }
  return (items as DeviceRow[]).map((d) => ({ id: d.id, label: d.name, subtitle: d.kind }));
}

export function useEntityOptions(kind: EntityKind, enabled = true) {
  return useQuery({
    queryKey: ["workflow-entity-options", kind],
    queryFn: () => fetchEntityOptions(kind),
    staleTime: 60_000,
    enabled,
  });
}

/**
 * id → display label across all pickable entity types; used to render config
 * summaries ("HomeLan" instead of a cuid) on node cards.
 */
export function useEntityLabels(): Map<string, string> {
  const networks = useEntityOptions("network");
  const vms = useEntityOptions("vm");
  const devices = useEntityOptions("device");
  const workflows = useEntityOptions("workflow");
  const integrations = useEntityOptions("integration");
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const data of [networks.data, vms.data, devices.data, integrations.data, workflows.data]) {
      for (const opt of data ?? []) map.set(opt.id, opt.label);
    }
    return map;
  }, [networks.data, vms.data, devices.data, integrations.data, workflows.data]);
}
