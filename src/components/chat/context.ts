import type { ChatContext, ChatSubjectEntityKind } from "@/lib/ai/agent/contract";

/**
 * Pure helper: derive an optional focused subject from the current pathname so
 * "what is this?" works on detail pages. Path itself is always sent; this is
 * best-effort sugar and deliberately conservative.
 */

const INVENTORY_DETAIL = /^\/inventory\/(hosts|vms|containers|services)\/([^/]+)\/?$/;

/** URL segment -> the kind the get_entity tool expects. */
const INVENTORY_ENTITY_KIND: Record<string, ChatSubjectEntityKind> = {
  hosts: "device",
  vms: "vm",
  containers: "container",
  services: "service",
};
const NETWORK_DETAIL = /^\/network\/([^/]+)\/?$/;
const DOC_DETAIL = /^\/docs\/([^/]+)\/?$/;

/** Static children of /network that are pages, not network ids. */
const NETWORK_STATIC = new Set(["ips", "switches", "wifi", "dhcp", "access-map"]);
const DOCS_STATIC = new Set(["new"]);

export function deriveSubject(path: string | null | undefined): ChatContext["subject"] {
  if (!path) return undefined;

  const inventory = INVENTORY_DETAIL.exec(path);
  if (inventory) {
    return {
      kind: "entity",
      value: decodeURIComponent(inventory[2]),
      entityKind: INVENTORY_ENTITY_KIND[inventory[1]],
    };
  }

  const network = NETWORK_DETAIL.exec(path);
  if (network && !NETWORK_STATIC.has(network[1])) {
    return { kind: "entity", value: decodeURIComponent(network[1]), entityKind: "network" };
  }

  const doc = DOC_DETAIL.exec(path);
  if (doc && !DOCS_STATIC.has(doc[1])) {
    return {
      kind: "entity",
      value: decodeURIComponent(doc[1]),
      label: "documentation page",
      entityKind: "doc",
    };
  }

  return undefined;
}

export function buildChatContext(path: string | null | undefined): ChatContext | undefined {
  if (!path) return undefined;
  const subject = deriveSubject(path);
  return subject ? { path, subject } : { path };
}
