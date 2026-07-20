import type { NodeCategory } from "@/lib/workflows/types";

/** Stable category order shared by the catalog search model and visual metadata. */
export const CATEGORY_ORDER: NodeCategory[] = [
  "trigger",
  "control",
  "inventory",
  "ssh",
  "proxmox",
  "docs",
  "http",
  "notify",
  "ai",
  "logs",
  "workflow",
];

/** Human labels stay UI-framework independent so catalog search is a pure operation. */
export const CATEGORY_LABELS: Record<NodeCategory, string> = {
  trigger: "Trigger",
  control: "Control",
  inventory: "Inventory",
  ssh: "SSH",
  proxmox: "Proxmox",
  docs: "Docs",
  http: "HTTP",
  notify: "Notify",
  ai: "AI",
  logs: "Logs",
  workflow: "Workflows",
};
