/**
 * Entity type vocabulary shared by `get_entity`, `search`, notes, tags and
 * the per-entity documentation resource (pure).
 */
import { z } from "zod";

export const ENTITY_TYPES = [
  "device",
  "vm",
  "container",
  "network",
  "service",
  "storage_pool",
  "ip",
  "doc",
  "ticket",
  "workflow",
  "ssh_key",
  "firewall_rule",
  "port_forward",
  "tunnel",
  "connector",
  "edge_server",
  "privacy_router",
  "integration",
  "sync_run",
  "switch",
  "wireless_network",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Inventory types that carry PolySIEM-owned documentation fields and tags. */
export const INVENTORY_TYPES = ["device", "vm", "container", "network", "service"] as const;
export type InventoryType = (typeof INVENTORY_TYPES)[number];

export const entityTypeInput = z.enum(ENTITY_TYPES);

/** Dashboard path for an entity, so the agent can hand the user a link. */
export function entityHref(type: EntityType, id: string, slug?: string): string | null {
  switch (type) {
    case "device": return `/inventory/hosts/${id}`;
    case "vm": return `/inventory/vms/${id}`;
    case "container": return `/inventory/containers/${id}`;
    case "network": return `/network/${id}`;
    case "service": return `/inventory/services/${id}`;
    case "doc": return `/docs/${slug ?? id}`;
    case "ssh_key": return `/keys/${id}`;
    case "workflow": return `/workflows/${id}`;
    case "switch": return `/network/switches/${id}`;
    default: return null;
  }
}

export interface EntityRef {
  type: EntityType;
  id: string;
  name: string;
  subtitle?: string | null;
}

/** Host part of an integration base URL (never userinfo, path or query). */
export function hostOf(baseUrl: string | null | undefined): string | null {
  if (!baseUrl) return null;
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}
