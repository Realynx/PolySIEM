import "server-only";

import { ApiError } from "@/lib/api";
import { audit, type AuditActor } from "@/lib/audit";
import { prisma } from "@/lib/db";
import * as inventory from "@/lib/services/inventory";
import { updateSshKey } from "@/lib/services/ssh-keys";

/*
 * Notes are appended to the PolySIEM-owned free-text field of an entity
 * (description, firewall/NAT annotation, SSH key purpose). Those fields
 * survive integration syncs, so no schema change is needed.
 */

export const NOTE_TYPES = ["device", "vm", "container", "network", "service", "firewall_rule", "port_forward", "ssh_key"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

const FIELD_LIMIT: Record<NoteType, number> = {
  device: 50_000,
  vm: 50_000,
  container: 50_000,
  network: 50_000,
  service: 50_000,
  firewall_rule: 10_000,
  port_forward: 10_000,
  ssh_key: 10_000,
};

/** Append a dated note block to existing text (pure). */
export function appendNote(existing: string | null | undefined, note: string, now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10);
  const block = `**Note (${stamp}, via MCP):** ${note.trim()}`;
  const base = (existing ?? "").trimEnd();
  return base ? `${base}\n\n${block}` : block;
}

async function currentText(type: NoteType, id: string): Promise<string | null> {
  const select = { where: { id } } as const;
  const row = await (async () => {
    switch (type) {
      case "device": return prisma.device.findUnique({ ...select, select: { description: true } });
      case "vm": return prisma.virtualMachine.findUnique({ ...select, select: { description: true } });
      case "container": return prisma.container.findUnique({ ...select, select: { description: true } });
      case "network": return prisma.network.findUnique({ ...select, select: { description: true } });
      case "service": return prisma.service.findUnique({ ...select, select: { description: true } });
      case "firewall_rule": return prisma.firewallRule.findUnique({ ...select, select: { annotation: true } }).then((r) => r && { description: r.annotation });
      case "port_forward": return prisma.portForward.findUnique({ ...select, select: { annotation: true } }).then((r) => r && { description: r.annotation });
      case "ssh_key": return prisma.sshKey.findUnique({ ...select, select: { purpose: true } }).then((r) => r && { description: r.purpose });
    }
  })();
  if (!row) throw new ApiError(404, "not_found", `No ${type} with id "${id}"`);
  return row.description;
}

/** Replace the PolySIEM-owned annotation of a port forward (no service exists for it). */
export async function setPortForwardAnnotation(actor: AuditActor, id: string, annotation: string | null) {
  if (!(await prisma.portForward.findUnique({ where: { id }, select: { id: true } }))) {
    throw new ApiError(404, "not_found", `No port_forward with id "${id}"`);
  }
  const row = await prisma.portForward.update({ where: { id }, data: { annotation }, select: { id: true, annotation: true } });
  await audit(actor, "port_forward.annotate", { type: "port_forward", id });
  return row;
}

async function writeText(actor: AuditActor, type: NoteType, id: string, text: string) {
  switch (type) {
    case "device": return inventory.updateDevice(actor, id, { description: text });
    case "vm": return inventory.updateVm(actor, id, { description: text });
    case "container": return inventory.updateContainer(actor, id, { description: text });
    case "network": return inventory.updateNetwork(actor, id, { description: text });
    case "service": return inventory.updateService(actor, id, { description: text });
    case "firewall_rule": return inventory.updateFirewallRuleAnnotation(actor, id, { annotation: text });
    case "port_forward": return setPortForwardAnnotation(actor, id, text);
    case "ssh_key": return updateSshKey(actor, id, { purpose: text });
  }
}

export async function addNote(actor: AuditActor, type: NoteType, id: string, note: string) {
  const next = appendNote(await currentText(type, id), note);
  if (next.length > FIELD_LIMIT[type]) {
    throw new ApiError(400, "too_long", `The ${type}'s notes would exceed ${FIELD_LIMIT[type]} characters. Move long-form material into a doc page with write_doc and link it.`);
  }
  await writeText(actor, type, id, next);
  return { type, id, appended: true, length: next.length };
}
