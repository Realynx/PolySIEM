import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError } from "@/lib/api";
import { addNote, NOTE_TYPES, setPortForwardAnnotation } from "@/lib/mcp/notes";
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

const writeHint = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

export function registerInventoryWriteTools(server: McpServer): void {
  server.registerTool(
    "create_entity",
    {
      title: "Create inventory entity",
      description:
        "Document something PolySIEM cannot discover by creating a MANUAL inventory record (it does not create anything on real infrastructure). type selects the entity; fields is the entity payload validated against the matching schema. " +
        "device: {name, kind?, description?, manufacturer?, model?, location?, cpuModel?, cpuCores?, memoryBytes?, osName?, osVersion?}. " +
        "vm: {name, description?, hostId?, powerState?, cpuCores?, memoryBytes?, diskBytes?, osName?}. " +
        "container: {name, runtime?, description?, hostId?, vmId?, powerState?, cpuCores?, memoryBytes?, diskBytes?, osName?}. " +
        "network: {name, description?, vlanId?, cidr?, gateway?, domain?, purpose?}. " +
        "service: {name, description?, url?, port?, protocol?, deviceId?, vmId?, containerId?}.",
      inputSchema: {
        type: z.enum(CREATABLE_TYPES).describe("Entity type to create"),
        fields: z.record(z.string(), z.unknown()).describe("Entity fields (see description for the shape per type)"),
      },
      annotations: writeHint,
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
        "REPLACE the human documentation fields of an inventory entity (to append instead, use add_note). These fields survive integration syncs. " +
        "Supported per type — device: description, location; network: description, purpose; vm/container/service: description. " +
        "Integration-owned fields cannot be edited; the service rejects them.",
      inputSchema: {
        type: z.enum(CREATABLE_TYPES).describe("Entity type"),
        id: z.string().min(1).describe("Entity id"),
        description: z.string().max(50_000).nullable().optional().describe("Free-text description (null clears)"),
        location: z.string().max(255).nullable().optional().describe("Physical location (devices only)"),
        purpose: z.string().max(64).nullable().optional().describe("Network purpose label (networks only)"),
      },
      annotations: { ...writeHint, idempotentHint: true },
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
    "set_annotation",
    {
      title: "Set firewall/NAT annotation",
      description:
        "Replace the PolySIEM-owned operator note on a firewall rule or port forward (pass null to clear). The note survives OPNsense syncs and is shown next to the rule. It never changes the rule itself: PolySIEM does not push firewall changes. To append rather than replace, use add_note.",
      inputSchema: {
        target: z.enum(["firewall_rule", "port_forward"]).optional().describe("Default firewall_rule"),
        id: z.string().trim().min(1).max(128).describe("Rule or port-forward id"),
        annotation: z.string().max(10_000).nullable().describe("Operator note (null clears)"),
      },
      annotations: writeHint,
    },
    async (args, extra) =>
      run("write_docs", extra, (actor) =>
        args.target === "port_forward"
          ? setPortForwardAnnotation(actor, args.id, args.annotation)
          : inventory.updateFirewallRuleAnnotation(actor, args.id, updateFirewallRuleSchema.parse({ annotation: args.annotation })),
      ),
  );

  server.registerTool(
    "add_note",
    {
      title: "Add a note to an entity",
      description:
        "Append a dated note to an entity's PolySIEM-owned notes without overwriting what is there: the description of a device/VM/container/network/service, the annotation of a firewall rule or port forward, or the purpose of an SSH key. Notes survive integration syncs. Use for findings, decisions and context discovered while investigating.",
      inputSchema: {
        type: z.enum(NOTE_TYPES).describe("Entity type"),
        id: z.string().trim().min(1).max(128).describe("Entity id (resolve names with get_entity first)"),
        note: z.string().trim().min(1).max(5_000).describe("Markdown note text"),
      },
      annotations: writeHint,
    },
    async (args, extra) => run("write_docs", extra, (actor) => addNote(actor, args.type, args.id, args.note)),
  );
}
