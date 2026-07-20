import { z } from "zod";
import { installKeyOnProxmoxVm } from "@/lib/services/ssh-keys";
import type { ActionDefinition } from "../registry";

const configSchema = z.object({
  vmId: z.string().min(1),
  sshKeyId: z.string().min(1),
  username: z.string().min(1).max(64).optional(),
});

/**
 * proxmox.install-ssh-key — install a documented public key into a Proxmox
 * VM's cloud-init `sshkeys` via the PVE API, recording an SshKeyDeployment.
 * Reuses the /keys feature's install path verbatim, including its 403
 * guidance when the API token is read-only (PVEAuditor).
 */
export const proxmoxInstallSshKey: ActionDefinition = {
  meta: {
    kind: "proxmox.install-ssh-key",
    title: "Install key on Proxmox VM",
    description:
      "Appends an SSH public key to a QEMU VM's cloud-init sshkeys via the Proxmox API and records the deployment. Cloud-init applies it on the next boot. Needs a write-capable PVE token.",
    category: "proxmox",
    inputs: [
      {
        key: "vmId",
        label: "Virtual machine",
        type: "vm",
        required: true,
        templateable: true,
        help: "Proxmox QEMU VM — pick one or reference a trigger param like {{input.vm}}.",
      },
      {
        key: "sshKeyId",
        label: "SSH key",
        type: "string",
        required: true,
        templateable: true,
        placeholder: "{{nodes.<nodeId>.sshKeyId}}",
        help: "Id of a documented SSH key, usually the output of a Generate SSH key step.",
      },
      {
        key: "username",
        label: "Username",
        type: "string",
        required: false,
        templateable: false,
        placeholder: "root",
        help: "Account recorded on the deployment (cloud-init installs for its configured user).",
      },
    ],
    outputs: [
      { key: "installed", label: "Installed (\"true\" if newly added)" },
      { key: "vmName", label: "VM name" },
      { key: "note", label: "Post-install note" },
    ],
  },
  configSchema,
  async run({ config, ctx }) {
    const { vmId, sshKeyId, username } = configSchema.parse(config);
    // ApiError 403 (pve_permission) from the shared install path carries the
    // write-token guidance the /keys UI shows; the executor surfaces its
    // message as the step error.
    const result = await installKeyOnProxmoxVm(ctx.actor, sshKeyId, {
      vmId,
      username: username?.trim() || "root",
    });
    return {
      installed: result.installed ? "true" : "false",
      vmName: result.vmName,
      note: result.alreadyPresent ? "Key was already present on the VM." : result.note,
    };
  },
};
