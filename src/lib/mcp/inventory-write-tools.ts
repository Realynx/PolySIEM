import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError } from "@/lib/api";
import { runTool as run } from "@/lib/mcp/tool-results";
import * as inventory from "@/lib/services/inventory";
import {
  createContainerSchema,
  createDeviceSchema,
  createNetworkSchema,
  createServiceSchema,
  createVmSchema,
  updateFirewallRuleSchema,
  type UpdateContainerInput,
  type UpdateDeviceInput,
  type UpdateNetworkInput,
  type UpdateServiceInput,
  type UpdateVmInput,
} from "@/lib/validators/inventory";

const CREATABLE_TYPES = ["device", "vm", "container", "network", "service"] as const;
type CreatableType = (typeof CREATABLE_TYPES)[number];

const DOC_FIELDS_BY_TYPE: Record<CreatableType, ReadonlyArray<"description" | "location" | "purpose">> = {
  device: ["description", "location"],
  vm: ["description"],
  container: ["description"],
  network: ["description", "purpose"],
  service: ["description"],
};

export function registerInventoryWriteTools(server: McpServer): void {
  server.registerTool(
    "create_entity",
    {
      title: "Create inventory entity",
      description:
        "Create a MANUAL inventory entity. type selects the entity; fields is the entity payload validated against the matching schema. " +
        "device: {name, kind?, description?, manufacturer?, model?, location?, cpuModel?, cpuCores?, memoryBytes?, osName?, osVersion?}. " +
        "vm: {name, description?, hostId?, powerState?, cpuCores?, memoryBytes?, diskBytes?, osName?}. " +
        "container: {name, runtime?, description?, hostId?, vmId?, powerState?, cpuCores?, memoryBytes?, diskBytes?, osName?}. " +
        "network: {name, description?, vlanId?, cidr?, gateway?, domain?, purpose?}. " +
        "service: {name, description?, url?, port?, protocol?, deviceId?, vmId?, containerId?}.",
      inputSchema: {
        type: z.enum(CREATABLE_TYPES).describe("Entity type to create"),
        fields: z.record(z.string(), z.unknown()).describe("Entity fields (see description for the shape per type)"),
      },
    },
    async (args, extra) =>
      run("write_docs", extra, (actor) => {
        const type = args.type as CreatableType;
        switch (type) {
          case "device":
            return inventory.createDevice(actor, createDeviceSchema.parse(args.fields));
          case "vm":
            return inventory.createVm(actor, createVmSchema.parse(args.fields));
          case "container":
            return inventory.createContainer(actor, createContainerSchema.parse(args.fields));
          case "network":
            return inventory.createNetwork(actor, createNetworkSchema.parse(args.fields));
          case "service":
            return inventory.createService(actor, createServiceSchema.parse(args.fields));
        }
      }),
  );

  server.registerTool(
    "update_entity_docs",
    {
      title: "Update entity documentation fields",
      description:
        "Update the human documentation fields of an inventory entity. These fields survive integration syncs. " +
        "Supported per type — device: description, location; network: description, purpose; vm/container/service: description. " +
        "Integration-owned fields cannot be edited; the service rejects them.",
      inputSchema: {
        type: z.enum(CREATABLE_TYPES).describe("Entity type"),
        id: z.string().min(1).describe("Entity id"),
        description: z.string().max(50_000).nullable().optional().describe("Free-text description (null clears)"),
        location: z.string().max(255).nullable().optional().describe("Physical location (devices only)"),
        purpose: z.string().max(64).nullable().optional().describe("Network purpose label (networks only)"),
      },
    },
    async (args, extra) =>
      run("write_docs", extra, (actor) => {
        const type = args.type as CreatableType;
        const allowed = DOC_FIELDS_BY_TYPE[type];
        const provided = (["description", "location", "purpose"] as const).filter(
          (key) => args[key] !== undefined,
        );
        if (provided.length === 0) {
          throw new ApiError(400, "no_fields", "Provide at least one of: description, location, purpose");
        }
        const illegal = provided.filter((key) => !allowed.includes(key));
        if (illegal.length > 0) {
          throw new ApiError(
            400,
            "invalid_field",
            `Field(s) ${illegal.join(", ")} are not supported for ${type}. Supported: ${allowed.join(", ")}.`,
          );
        }
        // Do not re-parse through partial create schemas: zod v4 defaults
        // would be reapplied and could clobber unrelated columns.
        const input = Object.fromEntries(provided.map((key) => [key, args[key]]));
        switch (type) {
          case "device":
            return inventory.updateDevice(actor, args.id, input as UpdateDeviceInput);
          case "vm":
            return inventory.updateVm(actor, args.id, input as UpdateVmInput);
          case "container":
            return inventory.updateContainer(actor, args.id, input as UpdateContainerInput);
          case "network":
            return inventory.updateNetwork(actor, args.id, input as UpdateNetworkInput);
          case "service":
            return inventory.updateService(actor, args.id, input as UpdateServiceInput);
        }
      }),
  );

  server.registerTool(
    "set_firewall_annotation",
    {
      title: "Set firewall rule annotation",
      description:
        "Set the PolySIEM-owned operator note on a firewall rule (the only writable firewall field; it survives OPNsense syncs). Pass null to clear. Never changes the rule itself.",
      inputSchema: {
        ruleId: z.string().min(1).describe("Firewall rule id"),
        annotation: z.string().max(10_000).nullable().describe("Operator note (null clears)"),
      },
    },
    async (args, extra) =>
      run("write_docs", extra, (actor) =>
        inventory.updateFirewallRuleAnnotation(
          actor,
          args.ruleId,
          updateFirewallRuleSchema.parse({ annotation: args.annotation }),
        ),
      ),
  );
}
