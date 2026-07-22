import { isMock, type DriverConfig, type TestResult } from "../types";
import type { ContainerCreateRequest } from "../provisioning";
import { fetchJson, HttpError } from "../http";
import {
  computeMetricKey,
  type ComputeResourceMetric,
  type ComputeStoragePool,
} from "@/lib/compute/metrics";
import {
  emptyPveClusterFirewall,
  type ProxmoxSnapshot,
  type PveClusterFirewall,
  type PveFirewallRule,
  type PveGuest,
  type PveGuestFirewall,
  type PveGuestNic,
  type PveNode,
  type PveNodeIface,
  type PveStorage,
} from "./sync";
import type {
  RawAgentNetworkInterface,
  PveContainerOptions,
  RawAgentNetworkResult,
  RawClusterResource,
  RawFwAlias,
  RawFwGroup,
  RawFwIpset,
  RawFwIpsetEntry,
  RawFwRule,
  RawGuestConfig,
  RawGuestFwOptions,
  RawGuestListItem,
  RawNetIface,
  RawNode,
  RawNodeStatus,
  RawStorage,
  RawStorageContent,
  RawStorageResource,
  RawTaskStatus,
} from "./client-types";

export type { PveContainerOptions } from "./client-types";

/**
 * Minimal Proxmox VE API client (token auth). Docs: https://pve.proxmox.com/pve-docs/api-viewer/
 * Auth header: `Authorization: PVEAPIToken=<tokenId>=<tokenSecret>`.
 */

interface PveEnvelope<T> {
  data: T;
}

function authHeaders(cfg: DriverConfig): Record<string, string> {
  return { Authorization: `PVEAPIToken=${cfg.credentials.tokenId}=${cfg.credentials.tokenSecret}` };
}

async function pveGet<T>(cfg: DriverConfig, path: string): Promise<T> {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const res = await fetchJson<PveEnvelope<T>>(cfg, `${base}/api2/json${path}`, {
    headers: authHeaders(cfg),
    timeoutMs: 10_000,
  });
  return res.data;
}

async function pvePost<T>(cfg: DriverConfig, path: string, fields: URLSearchParams): Promise<T> {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const res = await fetchJson<PveEnvelope<T>>(cfg, `${base}/api2/json${path}`, {
    method: "POST",
    headers: { ...authHeaders(cfg), "Content-Type": "application/x-www-form-urlencoded" },
    body: fields.toString(),
    timeoutMs: 30_000,
  });
  return res.data;
}

/**
 * Strict RFC 3986 percent-encoding. Proxmox stores the cloud-init `sshkeys`
 * config value URL-encoded and rejects the characters encodeURIComponent
 * leaves bare (! ' ( ) *).
 */
function strictEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Fetch one QEMU VM's raw config hash (includes percent-encoded `sshkeys`). */
export async function getVmConfig(cfg: DriverConfig, node: string, vmid: number): Promise<Record<string, unknown>> {
  return pveGet<Record<string, unknown>>(cfg, `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`);
}

/**
 * Write the cloud-init `sshkeys` value for a QEMU VM. `keysText` is the plain
 * (decoded) authorized_keys text; it is stored percent-encoded, and the PUT is
 * form-encoded on top of that — hence the double encoding.
 * Requires VM.Config.Cloudinit on the VM (a 403 surfaces as HttpError).
 */
export async function setVmCloudInitSshKeys(
  cfg: DriverConfig,
  node: string,
  vmid: number,
  keysText: string,
): Promise<void> {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const body = `sshkeys=${encodeURIComponent(strictEncode(keysText))}`;
  await fetchJson<PveEnvelope<unknown>>(cfg, `${base}/api2/json/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`, {
    method: "PUT",
    headers: { ...authHeaders(cfg), "Content-Type": "application/x-www-form-urlencoded" },
    body,
    timeoutMs: 10_000,
  });
}

export async function testProxmoxConnection(cfg: DriverConfig): Promise<TestResult> {
  try {
    const version = await pveGet<{ version?: string; release?: string }>(cfg, "/version");
    await pveGet<RawNode[]>(cfg, "/nodes");
    const v = [version.version, version.release ? `(${version.release})` : null].filter(Boolean).join(" ");
    return {
      ok: true,
      detail: `Connected to Proxmox VE and verified cluster inventory access`,
      version: v || undefined,
    };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

function liveNumber(value: number | string | undefined): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return parsed !== undefined && Number.isFinite(parsed) ? parsed : null;
}

function utilization(value: number | string | undefined): number | null {
  const parsed = liveNumber(value);
  return parsed === null ? null : Math.min(1, Math.max(0, parsed));
}

function demoUtilization(seed: string): number {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return 0.08 + (hash % 5400) / 10_000;
}

/** Lightweight current metrics used by the Compute summary and 2D Lab Map. */
export async function fetchProxmoxLiveMetrics(cfg: DriverConfig): Promise<ComputeResourceMetric[]> {
  if (isMock(cfg)) {
    const { generateDemoScenarioFromUrl } = await import("@/lib/demo/scenario");
    const snapshot = generateDemoScenarioFromUrl(cfg.baseUrl).proxmox;
    return [
      ...snapshot.nodes.map((node) => {
        const externalId = `node/${node.name}`;
        const cpuUsage = node.status === "online" ? demoUtilization(externalId) : 0;
        const memoryTotalBytes = node.memoryBytes === null ? null : Number(node.memoryBytes);
        return {
          key: computeMetricKey(cfg.id, externalId),
          integrationId: cfg.id,
          clusterName: cfg.name,
          externalId,
          kind: "node" as const,
          name: node.name,
          node: node.name,
          status: node.status,
          cpuUsage,
          cpuCores: node.cpuCores,
          memoryUsedBytes: memoryTotalBytes === null ? null : Math.round(memoryTotalBytes * cpuUsage),
          memoryTotalBytes,
          diskUsedBytes: null,
          diskTotalBytes: null,
          uptimeSec: node.uptimeSec,
        };
      }),
      ...snapshot.guests.map((guest) => {
        const externalId = `${guest.kind}/${guest.vmid}@${guest.node}`;
        const running = guest.status === "running";
        const cpuUsage = running ? demoUtilization(externalId) : 0;
        const memoryTotalBytes = guest.memoryBytes === null ? null : Number(guest.memoryBytes);
        const diskTotalBytes = guest.diskBytes === null ? null : Number(guest.diskBytes);
        return {
          key: computeMetricKey(cfg.id, externalId),
          integrationId: cfg.id,
          clusterName: cfg.name,
          externalId,
          kind: guest.kind,
          name: guest.name,
          node: guest.node,
          status: guest.status,
          cpuUsage,
          cpuCores: guest.cpuCores,
          memoryUsedBytes: memoryTotalBytes === null || !running ? 0 : Math.round(memoryTotalBytes * cpuUsage),
          memoryTotalBytes,
          diskUsedBytes: diskTotalBytes === null ? null : Math.round(diskTotalBytes * 0.55),
          diskTotalBytes,
          uptimeSec: running ? 86_400 : 0,
        };
      }),
    ];
  }

  const rows = await pveGet<RawClusterResource[]>(cfg, "/cluster/resources");
  return rows.flatMap((row): ComputeResourceMetric[] => {
    if (row.type !== "node" && row.type !== "qemu" && row.type !== "lxc") return [];
    const node = row.node ?? (row.type === "node" ? row.name : undefined);
    if (!node) return [];
    const externalId =
      row.type === "node"
        ? `node/${node}`
        : `${row.type}/${row.vmid ?? row.id?.split("/")[1] ?? "unknown"}@${node}`;
    return [{
      key: computeMetricKey(cfg.id, externalId),
      integrationId: cfg.id,
      clusterName: cfg.name,
      externalId,
      kind: row.type,
      name: row.name ?? node,
      node,
      status: row.status ?? "unknown",
      cpuUsage: utilization(row.cpu),
      cpuCores: liveNumber(row.maxcpu),
      memoryUsedBytes: liveNumber(row.mem),
      memoryTotalBytes: liveNumber(row.maxmem),
      diskUsedBytes: liveNumber(row.disk),
      diskTotalBytes: liveNumber(row.maxdisk),
      uptimeSec: liveNumber(row.uptime),
    }];
  });
}

/**
 * Backing storage pools for the whole cluster in one call. Node rows only carry
 * their root filesystem, so this is the only source of real lab capacity.
 * Unavailable pools are skipped — Proxmox reports them with a stale maxdisk.
 */
export async function fetchProxmoxStoragePools(cfg: DriverConfig): Promise<ComputeStoragePool[]> {
  if (isMock(cfg)) {
    const { generateDemoScenarioFromUrl } = await import("@/lib/demo/scenario");
    return generateDemoScenarioFromUrl(cfg.baseUrl).proxmox.storage.map((pool) => ({
      id: `storage/${pool.node}/${pool.name}`,
      name: pool.name,
      node: pool.node,
      shared: pool.shared,
      usedBytes: pool.usedBytes === null ? null : Number(pool.usedBytes),
      totalBytes: pool.totalBytes === null ? null : Number(pool.totalBytes),
    }));
  }

  const rows = await pveGet<RawStorageResource[]>(cfg, "/cluster/resources?type=storage");
  return rows.flatMap((row): ComputeStoragePool[] => {
    const name = row.storage;
    if (!name || (row.status && row.status !== "available")) return [];
    return [{
      id: row.id ?? `storage/${row.node ?? "cluster"}/${name}`,
      name,
      node: row.node ?? null,
      shared: row.shared === 1 || row.shared === true,
      usedBytes: liveNumber(row.disk),
      totalBytes: liveNumber(row.maxdisk),
    }];
  });
}

export type PveCreateContainerInput = ContainerCreateRequest;

export async function listPveProvisioningNodes(
  cfg: DriverConfig,
): Promise<{ id: string; online: boolean }[]> {
  const nodes = await pveGet<RawNode[]>(cfg, "/nodes");
  return nodes.map((node) => ({ id: node.node, online: node.status === "online" }));
}

export async function getPveContainerOptions(cfg: DriverConfig, node: string): Promise<PveContainerOptions> {
  const nodePath = encodeURIComponent(node);
  const [nextIdRaw, rawStorages, rawNetworks] = await Promise.all([
    pveGet<number | string>(cfg, "/cluster/nextid"),
    pveGet<RawStorage[]>(cfg, `/nodes/${nodePath}/storage`),
    pveGet<RawNetIface[]>(cfg, `/nodes/${nodePath}/network`),
  ]);
  const nextVmid = Number(nextIdRaw);
  if (!Number.isInteger(nextVmid)) throw new Error("Proxmox returned an invalid next VMID");

  const active = (value: number | boolean | undefined) => value === undefined || value === 1 || value === true;
  const storages = rawStorages
    .filter((storage) => active(storage.active) && active(storage.enabled) && storage.content?.split(",").includes("rootdir"))
    .map((storage) => ({ id: storage.storage, availableBytes: storage.avail ?? null }));
  const templateStores = rawStorages.filter(
    (storage) => active(storage.active) && active(storage.enabled) && storage.content?.split(",").includes("vztmpl"),
  );
  const templateRows = await Promise.all(
    templateStores.map(async (storage) => {
      const rows = await pveGet<RawStorageContent[]>(
        cfg,
        `/nodes/${nodePath}/storage/${encodeURIComponent(storage.storage)}/content?content=vztmpl`,
      );
      return rows.flatMap((row) =>
        row.volid
          ? [{ id: row.volid, label: row.volid.split("/").at(-1) ?? row.volid }]
          : [],
      );
    }),
  );
  const networks = rawNetworks
    .filter((network) => network.type === "bridge" && active(network.active))
    .map((network) => ({ id: network.iface }));

  return {
    nextVmid,
    storages: storages.sort((a, b) => a.id.localeCompare(b.id)),
    templates: templateRows.flat().sort((a, b) => a.label.localeCompare(b.label)),
    networks: networks.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Create an LXC container and return its Proxmox background-task UPID. */
export async function createPveContainer(cfg: DriverConfig, input: PveCreateContainerInput): Promise<string> {
  const fields = new URLSearchParams({
    vmid: String(input.vmid),
    hostname: input.hostname,
    ostemplate: input.template,
    rootfs: `${input.rootStorage}:${input.diskGiB}`,
    cores: String(input.cores),
    memory: String(input.memoryMiB),
    swap: String(input.swapMiB),
    unprivileged: input.unprivileged ? "1" : "0",
    start: input.start ? "1" : "0",
    description: "Provisioned by PolySIEM",
  });
  const netParts = [
    "name=eth0",
    `bridge=${input.bridge}`,
    `ip=${input.ipv4Mode === "dhcp" ? "dhcp" : input.ipv4Address}`,
    `firewall=${input.firewall ? 1 : 0}`,
  ];
  if (input.ipv4Mode === "static" && input.gateway) netParts.push(`gw=${input.gateway}`);
  if (input.vlanTag !== undefined) netParts.push(`tag=${input.vlanTag}`);
  fields.set("net0", netParts.join(","));
  if (input.publicKey) fields.set("ssh-public-keys", input.publicKey);

  return pvePost<string>(cfg, `/nodes/${encodeURIComponent(input.node)}/lxc`, fields);
}

/** Wait for a PVE worker task, failing on timeout or a non-OK exit status. */
export async function waitForPveTask(
  cfg: DriverConfig,
  node: string,
  upid: string,
  timeoutMs = 5 * 60_000,
): Promise<void> {
  const startedAt = Date.now();
  const path = `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`;
  while (Date.now() - startedAt < timeoutMs) {
    const task = await pveGet<RawTaskStatus>(cfg, path);
    if (task.status === "stopped") {
      if (task.exitstatus === "OK") return;
      throw new Error(`Proxmox task failed: ${task.exitstatus ?? "unknown exit status"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error("Timed out waiting for Proxmox to create the container");
}

// ---------- parsing helpers ----------

const NIC_MODELS = new Set(["virtio", "e1000", "e1000e", "rtl8139", "vmxnet3"]);
const MAC_RE = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

/**
 * Parse a Proxmox netN config line into a normalized NIC.
 * QEMU: "virtio=BC:24:11:2A:6F:12,bridge=vmbr0,tag=20,firewall=1"
 * LXC:  "name=eth0,bridge=vmbr0,hwaddr=BC:24:11:2A:6F:12,ip=10.0.20.5/24,tag=20"
 */
export function parsePveNet(nicName: string, raw: string): PveGuestNic {
  let mac: string | null = null;
  let bridge: string | null = null;
  let vlanTag: number | null = null;
  let ip: string | null = null;
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (NIC_MODELS.has(key) && MAC_RE.test(value)) mac = value.toUpperCase();
    else if (key === "hwaddr" && MAC_RE.test(value)) mac = value.toUpperCase();
    else if (key === "bridge") bridge = value;
    else if (key === "tag") vlanTag = Number.isInteger(Number(value)) ? Number(value) : null;
    else if (key === "ip" && value !== "dhcp" && value !== "manual") ip = value.split("/")[0] || null;
  }
  return { name: nicName, mac, bridge, vlanTag, ip };
}

function guestNics(config: RawGuestConfig): PveGuestNic[] {
  const nics: PveGuestNic[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (/^net\d+$/.test(key) && typeof value === "string") nics.push(parsePveNet(key, value));
  }
  return nics.sort((a, b) => a.name.localeCompare(b.name));
}

function usableAgentIpv4(address: string | undefined): address is string {
  if (!address || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return false;
  return address !== "127.0.0.1" && !address.startsWith("169.254.");
}

/** Fill QEMU NIC addresses from the guest agent without replacing config identity. */
export function mergeGuestAgentAddresses(
  nics: PveGuestNic[],
  agentInterfaces: RawAgentNetworkInterface[],
): PveGuestNic[] {
  const addressByMac = new Map<string, string>();
  for (const iface of agentInterfaces) {
    const mac = iface["hardware-address"]?.toUpperCase();
    if (!mac) continue;
    const address = iface["ip-addresses"]?.find(
      (candidate) =>
        candidate["ip-address-type"] === "ipv4" &&
        usableAgentIpv4(candidate["ip-address"]),
    )?.["ip-address"];
    if (usableAgentIpv4(address)) addressByMac.set(mac, address);
  }
  return nics.map((nic) => ({
    ...nic,
    ip: nic.ip ?? (nic.mac ? addressByMac.get(nic.mac.toUpperCase()) ?? null : null),
  }));
}

function toOptionalString(v: number | string | undefined | null): string | null {
  if (v === undefined || v === null || v === "") return null;
  return String(v);
}

/** Normalize a raw firewall rule row (assumes it is NOT a group reference). */
function parseFwRule(raw: RawFwRule, index: number): PveFirewallRule {
  return {
    pos: typeof raw.pos === "number" ? raw.pos : index,
    direction: raw.type ?? "in",
    action: raw.action ?? "DROP",
    source: raw.source ?? null,
    dest: raw.dest ?? null,
    proto: raw.proto ?? null,
    dport: toOptionalString(raw.dport),
    sport: toOptionalString(raw.sport),
    comment: raw.comment ?? null,
    enabled: raw.enable !== 0,
    macro: raw.macro ?? null,
    iface: raw.iface ?? null,
    log: raw.log ?? null,
  };
}

/** True for guest-rule rows that reference a security group (`GROUP <name>`). */
function isGroupRef(raw: RawFwRule): boolean {
  return raw.type === "group" && typeof raw.action === "string" && raw.action.length > 0;
}

/**
 * Fetch the datacenter firewall: security groups + their rules, ipsets with
 * entries, aliases and cluster-level rules. Failures land in `errors` (PARTIAL run).
 */
async function fetchClusterFirewall(cfg: DriverConfig, errors: string[]): Promise<PveClusterFirewall> {
  const fw = emptyPveClusterFirewall();

  const fetchGroups = async (): Promise<void> => { try {
    const rawGroups = await pveGet<RawFwGroup[]>(cfg, "/cluster/firewall/groups");
    for (const g of rawGroups) {
      const rules: PveFirewallRule[] = [];
      try {
        const rawRules = await pveGet<RawFwRule[]>(cfg, `/cluster/firewall/groups/${encodeURIComponent(g.group)}`);
        rawRules.forEach((r, i) => rules.push(parseFwRule(r, i)));
      } catch (err) {
        errors.push(`firewall group ${g.group}: rules fetch failed (${err instanceof Error ? err.message : err})`);
      }
      fw.groups.push({ name: g.group, comment: g.comment ?? null, rules });
    }
  } catch (err) {
    errors.push(`cluster firewall: groups list failed (${err instanceof Error ? err.message : err})`);
  } };

  const fetchIpsets = async (): Promise<void> => { try {
    const rawSets = await pveGet<RawFwIpset[]>(cfg, "/cluster/firewall/ipset");
    for (const s of rawSets) {
      const cidrs: string[] = [];
      try {
        const entries = await pveGet<RawFwIpsetEntry[]>(cfg, `/cluster/firewall/ipset/${encodeURIComponent(s.name)}`);
        for (const e of entries) {
          if (e.nomatch === 1 || e.nomatch === true) continue;
          if (typeof e.cidr === "string" && e.cidr) cidrs.push(e.cidr);
        }
      } catch (err) {
        errors.push(`firewall ipset ${s.name}: entries fetch failed (${err instanceof Error ? err.message : err})`);
      }
      fw.ipsets.push({ name: s.name, comment: s.comment ?? null, cidrs });
    }
  } catch (err) {
    errors.push(`cluster firewall: ipset list failed (${err instanceof Error ? err.message : err})`);
  } };

  const fetchAliases = async (): Promise<void> => { try {
    const rawAliases = await pveGet<RawFwAlias[]>(cfg, "/cluster/firewall/aliases");
    for (const a of rawAliases) {
      fw.aliases.push({ name: a.name, cidr: a.cidr, comment: a.comment ?? null });
    }
  } catch (err) {
    errors.push(`cluster firewall: aliases fetch failed (${err instanceof Error ? err.message : err})`);
  } };

  const fetchRules = async (): Promise<void> => { try {
    const rawRules = await pveGet<RawFwRule[]>(cfg, "/cluster/firewall/rules");
    rawRules.forEach((r, i) => {
      // Cluster rules may also reference groups; keep only plain rules here.
      if (!isGroupRef(r)) fw.rules.push(parseFwRule(r, i));
    });
  } catch (err) {
    errors.push(`cluster firewall: rules fetch failed (${err instanceof Error ? err.message : err})`);
  } };

  await Promise.all([fetchGroups(), fetchIpsets(), fetchAliases(), fetchRules()]);

  return fw;
}

/**
 * Fetch a guest's firewall config (options + security-group references).
 * A 4xx on the options fetch means the guest simply has no firewall config —
 * returns null without touching `errors`. Other failures are recorded.
 */
async function fetchGuestFirewall(
  cfg: DriverConfig,
  node: string,
  kind: "qemu" | "lxc",
  vmid: number,
  errors: string[],
): Promise<PveGuestFirewall | null> {
  let options: RawGuestFwOptions;
  try {
    options = await pveGet<RawGuestFwOptions>(cfg, `/nodes/${node}/${kind}/${vmid}/firewall/options`);
  } catch (err) {
    if (err instanceof HttpError && err.status >= 400 && err.status < 500) return null;
    errors.push(`${kind}/${vmid}@${node}: firewall options fetch failed (${err instanceof Error ? err.message : err})`);
    return null;
  }

  const groups: string[] = [];
  const rules: PveFirewallRule[] = [];
  try {
    const rawRules = await pveGet<RawFwRule[]>(cfg, `/nodes/${node}/${kind}/${vmid}/firewall/rules`);
    for (const [index, rule] of rawRules.entries()) {
      if (isGroupRef(rule)) groups.push(String(rule.action));
      else rules.push(parseFwRule(rule, index));
    }
  } catch (err) {
    if (!(err instanceof HttpError && err.status >= 400 && err.status < 500)) {
      errors.push(`${kind}/${vmid}@${node}: firewall rules fetch failed (${err instanceof Error ? err.message : err})`);
    }
  }

  return {
    enabled: options.enable === 1,
    policyIn: typeof options.policy_in === "string" ? options.policy_in : null,
    groups,
    rules,
  };
}

const MiB = 1024 ** 2;

function toBigInt(n: number | string | undefined | null): bigint | null {
  const v = typeof n === "string" ? Number(n) : n;
  if (v === undefined || v === null || !Number.isFinite(v)) return null;
  return BigInt(Math.round(v));
}

async function fetchNodeRecord(cfg: DriverConfig, rawNode: RawNode, errors: string[]): Promise<PveNode> {
  const name = rawNode.node;
  let status: RawNodeStatus = {};
  try { status = await pveGet<RawNodeStatus>(cfg, `/nodes/${name}/status`); } catch { /* Offline nodes may reject status. */ }
  let interfaces: PveNodeIface[] = [];
  try {
    const rawIfaces = await pveGet<RawNetIface[]>(cfg, `/nodes/${name}/network`);
    interfaces = rawIfaces.map((iface) => ({
      name: iface.iface,
      type: iface.type ?? "unknown",
      address: iface.address ?? (iface.cidr ? iface.cidr.split("/")[0] : null),
      cidr: iface.cidr ?? null,
      gateway: iface.gateway ?? null,
      mac: null,
    }));
  } catch (error) {
    errors.push(`node ${name}: network list failed (${error instanceof Error ? error.message : error})`);
  }
  return {
    name,
    status: rawNode.status ?? "unknown",
    cpuCores: status.cpuinfo?.cores ?? rawNode.maxcpu ?? null,
    cpuModel: status.cpuinfo?.model ?? null,
    memoryBytes: toBigInt(status.memory?.total ?? rawNode.maxmem),
    pveVersion: status.pveversion?.replace(/^pve-manager\//, "").split("/")[0] ?? null,
    uptimeSec: rawNode.uptime ?? null,
    interfaces,
  };
}

async function fetchGuestRecord(
  cfg: DriverConfig,
  node: string,
  kind: "qemu" | "lxc",
  item: RawGuestListItem,
  errors: string[],
): Promise<PveGuest> {
  const vmid = Number(item.vmid);
  let config: RawGuestConfig = {};
  try {
    config = await pveGet<RawGuestConfig>(cfg, `/nodes/${node}/${kind}/${vmid}/config`);
  } catch (error) {
    errors.push(`${kind}/${vmid}@${node}: config fetch failed (${error instanceof Error ? error.message : error})`);
  }
  const memMiB = typeof config.memory === "string" ? Number(config.memory) : config.memory;
  let nics = guestNics(config);
  if (kind === "qemu" && item.status === "running") {
    try {
      const agent = await pveGet<RawAgentNetworkResult>(cfg, `/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`);
      nics = mergeGuestAgentAddresses(nics, agent.result ?? []);
    } catch { /* Guest agent is optional. */ }
  }
  return {
    kind,
    node,
    vmid,
    name: item.name ?? String(vmid),
    status: item.status ?? "unknown",
    cpuCores: config.cores ? config.cores * (config.sockets ?? 1) : null,
    memoryBytes: guestMemoryBytes(memMiB),
    diskBytes: toBigInt(item.maxdisk),
    osName: typeof config.ostype === "string" ? config.ostype : null,
    description: typeof config.description === "string" ? config.description : null,
    nics,
    firewall: await fetchGuestFirewall(cfg, node, kind, vmid, errors),
  };
}

function guestMemoryBytes(memoryMiB: number | undefined): bigint | null {
  return memoryMiB && Number.isFinite(memoryMiB) ? BigInt(Math.round(memoryMiB * MiB)) : null;
}

async function fetchNodeGuests(
  cfg: DriverConfig,
  node: string,
  kind: "qemu" | "lxc",
  errors: string[],
): Promise<PveGuest[]> {
  try {
    const list = await pveGet<RawGuestListItem[]>(cfg, `/nodes/${node}/${kind}`);
    const guests: PveGuest[] = [];
    for (const item of list) {
      guests.push(await fetchGuestRecord(cfg, node, kind, item, errors));
    }
    return guests;
  } catch (error) {
    errors.push(`node ${node}: ${kind} list failed (${error instanceof Error ? error.message : error})`);
    return [];
  }
}

async function fetchNodeStorage(cfg: DriverConfig, node: string, errors: string[]): Promise<PveStorage[]> {
  try {
    const pools = await pveGet<RawStorage[]>(cfg, `/nodes/${node}/storage`);
    return pools.map((pool) => ({
      node,
      name: pool.storage,
      type: pool.type ?? null,
      totalBytes: toBigInt(pool.total),
      usedBytes: toBigInt(pool.used),
      content: pool.content ?? null,
      shared: pool.shared === 1 || pool.shared === true,
    }));
  } catch (error) {
    errors.push(`node ${node}: storage list failed (${error instanceof Error ? error.message : error})`);
    return [];
  }
}

// ---------- snapshot ----------

/** Fetch a full normalized snapshot from a live Proxmox VE cluster. */
export async function fetchProxmoxSnapshotFromApi(cfg: DriverConfig): Promise<ProxmoxSnapshot> {
  const errors: string[] = [];
  const nodes: PveNode[] = [];
  const guests: PveGuest[] = [];
  const storage: PveStorage[] = [];

  const rawNodes = await pveGet<RawNode[]>(cfg, "/nodes");
  const firewall = await fetchClusterFirewall(cfg, errors);

  for (const rawNode of rawNodes) {
    const name = rawNode.node;
    try {
      nodes.push(await fetchNodeRecord(cfg, rawNode, errors));
      const [qemu, lxc, nodeStorage] = await Promise.all([
        fetchNodeGuests(cfg, name, "qemu", errors),
        fetchNodeGuests(cfg, name, "lxc", errors),
        fetchNodeStorage(cfg, name, errors),
      ]);
      guests.push(...qemu, ...lxc);
      storage.push(...nodeStorage);
    } catch (err) {
      errors.push(`node ${name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return { nodes, guests, storage, firewall, errors };
}
