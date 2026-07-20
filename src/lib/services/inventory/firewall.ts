import "server-only";

import { prisma } from "@/lib/db";
import { audit, type AuditActor } from "@/lib/audit";
import type { UpdateFirewallRuleInput } from "@/lib/validators/inventory";
import { entityNotFound } from "./policies";

export async function listFirewallRules(filter?: {
  interfaceName?: string;
  action?: string;
}) {
  return prisma.firewallRule.findMany({
    where: {
      status: { not: "REMOVED" },
      ...(filter?.interfaceName ? { interfaceName: filter.interfaceName } : {}),
      ...(filter?.action ? { action: filter.action as never } : {}),
    },
    orderBy: [{ interfaceName: "asc" }, { sequence: "asc" }],
  });
}

export async function updateFirewallRuleAnnotation(
  actor: AuditActor,
  id: string,
  input: UpdateFirewallRuleInput,
) {
  if (!(await prisma.firewallRule.findUnique({ where: { id } }))) entityNotFound();
  const rule = await prisma.firewallRule.update({
    where: { id },
    data: { annotation: input.annotation },
  });
  await audit(actor, "firewall_rule.annotate", { type: "firewall_rule", id });
  return rule;
}

export async function listFirewallAliases() {
  return prisma.firewallAlias.findMany({
    where: { status: { not: "REMOVED" } },
    orderBy: { name: "asc" },
  });
}

