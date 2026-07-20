import type { DriverConfig } from "./types";

export interface ProvisioningNode {
  id: string;
  label: string;
  online: boolean;
}

export interface ProvisioningStorage {
  id: string;
  label: string;
  availableBytes: number | null;
}

export interface ProvisioningTemplate {
  id: string;
  label: string;
}

export interface ProvisioningNetwork {
  id: string;
  label: string;
}

export interface ContainerProvisioningOptions {
  nextVmid: number;
  storages: ProvisioningStorage[];
  templates: ProvisioningTemplate[];
  networks: ProvisioningNetwork[];
}

export interface ProvisioningTask {
  id: string;
  node: string;
  vmid: number;
}

/** Framework-neutral failure shape returned by provisioning providers. */
export interface ProvisioningFailure {
  status: number;
  code: string;
  message: string;
}

/** Shared fallback for provider failures that have no more specific mapping. */
export function genericProvisioningFailure(error: unknown): ProvisioningFailure {
  return {
    status: 502,
    code: "provider_error",
    message: error instanceof Error ? error.message : "The provider request failed",
  };
}

/** Provider-facing allowlist. UI/service-only identity fields are deliberately absent. */
export interface ContainerCreateRequest {
  node: string;
  vmid: number;
  hostname: string;
  template: string;
  rootStorage: string;
  diskGiB: number;
  cores: number;
  memoryMiB: number;
  swapMiB: number;
  bridge: string;
  ipv4Mode: "dhcp" | "static";
  ipv4Address?: string;
  gateway?: string;
  vlanTag?: number;
  publicKey?: string;
  unprivileged: boolean;
  start: boolean;
  firewall: boolean;
}

export type ProvisioningSelectionIssue = "template" | "storage" | "network";

/** Pure capability check shared by orchestration and unit tests. */
export function unsupportedContainerSelection(
  options: ContainerProvisioningOptions,
  selection: Pick<ContainerCreateRequest, "template" | "rootStorage" | "bridge">,
): ProvisioningSelectionIssue | null {
  if (!options.templates.some((item) => item.id === selection.template)) return "template";
  if (!options.storages.some((item) => item.id === selection.rootStorage)) return "storage";
  if (!options.networks.some((item) => item.id === selection.bridge)) return "network";
  return null;
}

/** Optional driver capability. Future compute integrations can implement this contract. */
export interface ContainerProvisioner {
  /** Translate provider-specific failures without depending on an HTTP framework. */
  translateFailure(error: unknown): ProvisioningFailure;
  listNodes(cfg: DriverConfig): Promise<ProvisioningNode[]>;
  getOptions(cfg: DriverConfig, node: string): Promise<ContainerProvisioningOptions>;
  create(cfg: DriverConfig, input: ContainerCreateRequest): Promise<ProvisioningTask>;
  wait(cfg: DriverConfig, task: ProvisioningTask): Promise<void>;
}
