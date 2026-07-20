import { z } from "zod";

/** Paste one or more public keys (authorized_keys format, possibly multi-line). */
export const createSshKeysSchema = z.object({
  /** Display name; only applied when the paste contains a single key. */
  name: z.string().min(1).max(128).optional(),
  ownerLabel: z.string().max(128).nullish(),
  purpose: z.string().max(10_000).nullish(),
  text: z.string().min(1, "Paste at least one public key").max(200_000),
});
export type CreateSshKeysInput = z.infer<typeof createSshKeysSchema>;

export const updateSshKeySchema = z
  .object({
    name: z.string().min(1).max(128),
    ownerLabel: z.string().max(128).nullish(),
    purpose: z.string().max(10_000).nullish(),
  })
  .partial();
export type UpdateSshKeyInput = z.infer<typeof updateSshKeySchema>;

export const generateSshKeySchema = z.object({
  name: z.string().min(1).max(128),
  comment: z.string().max(128).optional(),
  ownerLabel: z.string().max(128).nullish(),
  purpose: z.string().max(10_000).nullish(),
});
export type GenerateSshKeyInput = z.infer<typeof generateSshKeySchema>;

export const deploymentEntityTypes = ["device", "vm", "container", "other"] as const;

export const createDeploymentSchema = z
  .object({
    entityType: z.enum(deploymentEntityTypes),
    deviceId: z.string().min(1).nullish(),
    vmId: z.string().min(1).nullish(),
    containerId: z.string().min(1).nullish(),
    hostLabel: z.string().max(128).nullish(),
    username: z.string().min(1).max(64).default("root"),
    method: z.enum(["manual", "proxmox-cloudinit", "script"]).default("manual"),
    notes: z.string().max(2_000).nullish(),
  })
  .refine(
    (v) =>
      Boolean(
        { device: v.deviceId, vm: v.vmId, container: v.containerId, other: v.hostLabel }[v.entityType],
      ),
    { message: "The entity reference matching entityType is required (deviceId/vmId/containerId, or hostLabel for \"other\")" },
  );
export type CreateDeploymentInput = z.infer<typeof createDeploymentSchema>;

export const proxmoxInstallSchema = z.object({
  vmId: z.string().min(1),
  username: z.string().min(1).max(64).default("root"),
});
export type ProxmoxInstallInput = z.infer<typeof proxmoxInstallSchema>;
