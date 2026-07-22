import "server-only";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit, type AuditActor } from "@/lib/audit";
import {
  generateEd25519Keypair,
  parseAuthorizedKeys,
  type ParsedPublicKey,
} from "@/lib/ssh/keys";
import { toDriverConfig } from "@/lib/integrations/config";
import { isMock, type DriverConfig } from "@/lib/integrations/types";
import { HttpError } from "@/lib/integrations/http";
import type {
  CreateDeploymentInput,
  CreateSshKeysInput,
  GenerateSshKeyInput,
  ProxmoxInstallInput,
  UpdateSshKeyInput,
} from "@/lib/validators/ssh-keys";

const DEPLOYMENT_INCLUDE = {
  device: { select: { id: true, name: true } },
  vm: { select: { id: true, name: true } },
  container: { select: { id: true, name: true } },
} as const;

export async function listSshKeys() {
  const rows = await prisma.sshKey.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { deployments: true } } },
  });
  return rows.map(({ _count, ...row }) => ({ ...row, deploymentCount: _count.deployments }));
}

export async function getSshKey(id: string) {
  const row = await prisma.sshKey.findUnique({
    where: { id },
    include: {
      deployments: { orderBy: { createdAt: "asc" }, include: DEPLOYMENT_INCLUDE },
    },
  });
  if (!row) throw new ApiError(404, "not_found", "SSH key not found");
  return row;
}

/** Derive a display name for a bulk-imported key. */
function defaultKeyName(key: ParsedPublicKey): string {
  return key.comment ?? `${key.keyType} ${key.fingerprint.slice("SHA256:".length, "SHA256:".length + 8)}`;
}

/**
 * Create keys from pasted authorized_keys text (one or many lines).
 * Any unparsable line → 422 with per-line errors; any fingerprint already
 * documented (or duplicated within the paste) → 409 naming the existing key.
 */
export async function createSshKeysFromText(actor: AuditActor, input: CreateSshKeysInput) {
  const results = parseAuthorizedKeys(input.text);
  if (results.length === 0) {
    throw new ApiError(422, "no_keys", "No public keys found in the pasted text");
  }
  const bad = results.filter((r) => !r.ok);
  if (bad.length > 0) {
    const hasPrivate = bad.some((r) => !r.ok && r.code === "private_key");
    throw new ApiError(
      422,
      hasPrivate ? "private_key" : "unparsable_lines",
      hasPrivate
        ? "That paste contains PRIVATE key material — never paste private keys. Only public keys are documented."
        : `${bad.length} line${bad.length === 1 ? "" : "s"} could not be parsed: ` +
          bad
            .map((r) => (r.ok ? "" : `line ${r.lineNumber}: ${r.error}`))
            .filter(Boolean)
            .join("; "),
    );
  }

  const keys = results.map((r) => (r.ok ? r.key : null)).filter(Boolean) as ParsedPublicKey[];

  // Duplicates within the paste
  const seen = new Map<string, number>();
  for (const key of keys) {
    seen.set(key.fingerprint, (seen.get(key.fingerprint) ?? 0) + 1);
  }
  const pasteDupes = [...seen.entries()].filter(([, n]) => n > 1);
  if (pasteDupes.length > 0) {
    throw new ApiError(409, "duplicate_in_paste", `The paste contains the same key more than once (${pasteDupes.map(([fp]) => fp).join(", ")})`);
  }

  // Duplicates against already-documented keys
  const existing = await prisma.sshKey.findMany({
    where: { fingerprint: { in: keys.map((k) => k.fingerprint) } },
    select: { id: true, name: true, fingerprint: true },
  });
  if (existing.length > 0) {
    throw new ApiError(
      409,
      "duplicate_key",
      `Already documented: ${existing.map((e) => `"${e.name}" (${e.fingerprint})`).join(", ")}`,
    );
  }

  const created = await prisma.$transaction(
    keys.map((key, index) =>
      prisma.sshKey.create({
        data: {
          name: input.name?.trim()
            ? keys.length === 1
              ? input.name.trim()
              : `${input.name.trim()} (${index + 1})`
            : defaultKeyName(key),
          keyType: key.keyType,
          publicKey: key.line,
          fingerprint: key.fingerprint,
          bits: key.bits,
          comment: key.comment,
          purpose: input.purpose?.trim() || null,
          ownerLabel: input.ownerLabel?.trim() || null,
        },
      }),
    ),
  );

  for (const key of created) {
    await audit(actor, "sshkey.create", { type: "sshkey", id: key.id }, {
      name: key.name,
      fingerprint: key.fingerprint,
      keyType: key.keyType,
    });
  }
  return { keys: created };
}

/** Generate an ed25519 keypair, store ONLY the public half, return the private key once. */
export async function generateSshKey(actor: AuditActor, input: GenerateSshKeyInput) {
  const comment = input.comment?.trim() || `${input.name.trim().replace(/\s+/g, "-").toLowerCase()}@polysiem`;
  const pair = generateEd25519Keypair(comment);

  const existing = await prisma.sshKey.findUnique({ where: { fingerprint: pair.fingerprint } });
  if (existing) {
    // Practically impossible, but never overwrite.
    throw new ApiError(409, "duplicate_key", "Generated key collided with an existing fingerprint — try again");
  }

  const key = await prisma.sshKey.create({
    data: {
      name: input.name.trim(),
      keyType: "ssh-ed25519",
      publicKey: pair.publicKeyLine,
      fingerprint: pair.fingerprint,
      bits: 256,
      comment,
      purpose: input.purpose?.trim() || null,
      ownerLabel: input.ownerLabel?.trim() || null,
    },
  });
  await audit(actor, "sshkey.generate", { type: "sshkey", id: key.id }, {
    name: key.name,
    fingerprint: key.fingerprint,
    keyType: key.keyType,
    // deliberately no private key material here
  });
  return { key, privateKeyPem: pair.privateKeyPem };
}

export async function updateSshKey(actor: AuditActor, id: string, input: UpdateSshKeyInput) {
  await getSshKey(id);
  const key = await prisma.sshKey.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.ownerLabel !== undefined ? { ownerLabel: input.ownerLabel?.trim() || null } : {}),
      ...(input.purpose !== undefined ? { purpose: input.purpose?.trim() || null } : {}),
    },
  });
  await audit(actor, "sshkey.update", { type: "sshkey", id }, { fields: Object.keys(input) });
  return key;
}

export async function deleteSshKey(actor: AuditActor, id: string) {
  const existing = await getSshKey(id);
  await prisma.sshKey.delete({ where: { id } });
  await audit(actor, "sshkey.delete", { type: "sshkey", id }, {
    name: existing.name,
    fingerprint: existing.fingerprint,
  });
}

// ---------------------------------------------------------------------------
// Deployments
// ---------------------------------------------------------------------------

export async function addDeployment(actor: AuditActor, sshKeyId: string, input: CreateDeploymentInput) {
  await getSshKey(sshKeyId);

  // Validate the referenced entity exists and null out the others.
  let deviceId: string | null = null;
  let vmId: string | null = null;
  let containerId: string | null = null;
  let hostLabel: string | null = null;
  if (input.entityType === "device") {
    const device = await prisma.device.findUnique({ where: { id: input.deviceId! }, select: { id: true } });
    if (!device) throw new ApiError(404, "not_found", "Device not found");
    deviceId = device.id;
  } else if (input.entityType === "vm") {
    const vm = await prisma.virtualMachine.findUnique({ where: { id: input.vmId! }, select: { id: true } });
    if (!vm) throw new ApiError(404, "not_found", "Virtual machine not found");
    vmId = vm.id;
  } else if (input.entityType === "container") {
    const container = await prisma.container.findUnique({ where: { id: input.containerId! }, select: { id: true } });
    if (!container) throw new ApiError(404, "not_found", "Container not found");
    containerId = container.id;
  } else {
    hostLabel = input.hostLabel!.trim();
  }

  const deployment = await prisma.sshKeyDeployment.create({
    data: {
      sshKeyId,
      entityType: input.entityType,
      deviceId,
      vmId,
      containerId,
      hostLabel,
      username: input.username,
      method: input.method,
      notes: input.notes?.trim() || null,
    },
    include: DEPLOYMENT_INCLUDE,
  });
  await audit(actor, "sshkey.deploy", { type: "sshkey", id: sshKeyId }, {
    entityType: input.entityType,
    target: deployment.device?.name ?? deployment.vm?.name ?? deployment.container?.name ?? hostLabel,
    username: input.username,
    method: input.method,
  });
  return deployment;
}

export async function removeDeployment(actor: AuditActor, sshKeyId: string, deploymentId: string) {
  const deployment = await prisma.sshKeyDeployment.findUnique({
    where: { id: deploymentId },
    include: DEPLOYMENT_INCLUDE,
  });
  if (!deployment || deployment.sshKeyId !== sshKeyId) {
    throw new ApiError(404, "not_found", "Deployment record not found");
  }
  await prisma.sshKeyDeployment.delete({ where: { id: deploymentId } });
  await audit(actor, "sshkey.undeploy", { type: "sshkey", id: sshKeyId }, {
    entityType: deployment.entityType,
    target: deployment.device?.name ?? deployment.vm?.name ?? deployment.container?.name ?? deployment.hostLabel,
    username: deployment.username,
  });
}

// ---------------------------------------------------------------------------
// Proxmox cloud-init install
// ---------------------------------------------------------------------------

const PVE_EXTERNAL_ID_RE = /^qemu\/(\d+)@(.+)$/;

export interface ProxmoxInstallResult {
  installed: boolean;
  alreadyPresent: boolean;
  vmName: string;
  note: string;
}

async function installMockVmKey(vmid: number, publicKey: string): Promise<boolean> {
  const { mockGetVmSshKeys, mockHasQemuVm, mockSetVmSshKeys } = await import("@/lib/integrations/proxmox/mock");
  if (!mockHasQemuVm(vmid)) throw new ApiError(404, "not_found", `Demo cluster has no QEMU VM ${vmid}`);
  const current = mockGetVmSshKeys(vmid).split("\n").filter(Boolean);
  if (current.includes(publicKey)) return true;
  mockSetVmSshKeys(vmid, [...current, publicKey].join("\n"));
  return false;
}

async function installLiveVmKey(cfg: DriverConfig, node: string, vmid: number, publicKey: string): Promise<boolean> {
  const { getVmConfig, setVmCloudInitSshKeys } = await import("@/lib/integrations/proxmox/client");
  try {
    const config = await getVmConfig(cfg, node, vmid);
    const currentRaw = typeof config.sshkeys === "string" ? config.sshkeys : "";
    const current = (currentRaw ? decodeURIComponent(currentRaw) : "").split("\n").filter(Boolean);
    if (current.includes(publicKey)) return true;
    await setVmCloudInitSshKeys(cfg, node, vmid, [...current, publicKey].join("\n"));
    return false;
  } catch (error) {
    if (error instanceof HttpError && (error.status === 403 || error.status === 401)) {
      const tokenId = cfg.credentials.tokenId ?? "your API token";
      throw new ApiError(
        403,
        "pve_permission",
        `The Proxmox API token ${tokenId} is not allowed to edit VM ${vmid}'s cloud-init config. ` +
          `It needs VM.Config.Cloudinit + VM.Audit on this VM — e.g. ` +
          `pveum aclmod /vms/${vmid} -token '${tokenId}' -role PVEVMAdmin — ` +
          `or add a second, privileged token for installs and keep the sync token read-only.`,
      );
    }
    throw error;
  }
}

/**
 * Append the key to a Proxmox VM's cloud-init `sshkeys` via the PVE API and
 * record a deployment. Works against mock://demo integrations too.
 */
export async function installKeyOnProxmoxVm(
  actor: AuditActor,
  sshKeyId: string,
  input: ProxmoxInstallInput,
): Promise<ProxmoxInstallResult> {
  const key = await getSshKey(sshKeyId);
  const vm = await prisma.virtualMachine.findUnique({
    where: { id: input.vmId },
    include: { integration: true },
  });
  if (!vm) throw new ApiError(404, "not_found", "Virtual machine not found");
  if (vm.source !== "PROXMOX" || !vm.integration || vm.integration.type !== "PROXMOX") {
    throw new ApiError(422, "not_proxmox", "That VM is not managed by a Proxmox integration");
  }
  const match = PVE_EXTERNAL_ID_RE.exec(vm.externalId ?? "");
  if (!match) {
    throw new ApiError(422, "not_qemu", "Cloud-init SSH keys only apply to QEMU VMs (not LXC containers)");
  }
  const vmid = Number(match[1]);
  const node = match[2];
  const cfg = toDriverConfig(vm.integration);

  const alreadyPresent = isMock(cfg)
    ? await installMockVmKey(vmid, key.publicKey)
    : await installLiveVmKey(cfg, node, vmid, key.publicKey);

  // Record the deployment (idempotent per key+vm+username+method).
  const existing = await prisma.sshKeyDeployment.findFirst({
    where: { sshKeyId, vmId: vm.id, username: input.username, method: "proxmox-cloudinit" },
  });
  if (!existing) {
    await prisma.sshKeyDeployment.create({
      data: {
        sshKeyId,
        entityType: "vm",
        vmId: vm.id,
        username: input.username,
        method: "proxmox-cloudinit",
        notes: `Installed via Proxmox cloud-init (${node}/qemu/${vmid})`,
      },
    });
  }
  await audit(actor, "sshkey.proxmox_install", { type: "sshkey", id: sshKeyId }, {
    vm: vm.name,
    vmid,
    node,
    username: input.username,
    alreadyPresent,
  });

  return {
    installed: !alreadyPresent,
    alreadyPresent,
    vmName: vm.name,
    note:
      "Cloud-init applies SSH keys on the next boot (or cloud-init regeneration), and only to VMs that use cloud-init. " +
      "For a running VM, use the install script instead.",
  };
}
