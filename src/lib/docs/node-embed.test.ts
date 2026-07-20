import { describe, expect, it } from "vitest";
import {
  EMBEDDABLE_KINDS,
  buildContainerSummary,
  buildDeviceSummary,
  buildNetworkSummary,
  buildServiceSummary,
  buildVmSummary,
  isEmbeddableKind,
  nodeEmbedHref,
  parseNodeToken,
  serializeNodeToken,
  splitTextOnToken,
} from "./node-embed";

describe("isEmbeddableKind", () => {
  it("accepts every embeddable kind", () => {
    for (const kind of EMBEDDABLE_KINDS) expect(isEmbeddableKind(kind)).toBe(true);
  });

  it("rejects non-embeddable kinds and junk", () => {
    for (const v of ["ip", "doc", "storage", "", "DEVICE", null, undefined, 3]) {
      expect(isEmbeddableKind(v)).toBe(false);
    }
  });
});

describe("serializeNodeToken / parseNodeToken", () => {
  it("round-trips every kind", () => {
    for (const kind of EMBEDDABLE_KINDS) {
      const token = serializeNodeToken(kind, "clx8p0q2h0001abcd");
      expect(token).toBe(`{{node:${kind}:clx8p0q2h0001abcd}}`);
      expect(parseNodeToken(token)).toEqual({ kind, id: "clx8p0q2h0001abcd" });
    }
  });

  it("tolerates surrounding whitespace when parsing a lone token", () => {
    expect(parseNodeToken("  {{node:vm:abc123}}  ")).toEqual({ kind: "vm", id: "abc123" });
  });

  it("rejects unknown kinds", () => {
    expect(parseNodeToken("{{node:storage:abc}}")).toBeNull();
    expect(parseNodeToken("{{node:ip:abc}}")).toBeNull();
  });

  it("rejects malformed tokens", () => {
    for (const bad of [
      "{{node:vm:}}", // empty id
      "{{node:vm}}", // missing id segment
      "{{node:vm:a b}}", // id with space
      "{{node:vm:abc}} extra", // trailing text — not a lone token
      "{{ node:vm:abc }}", // inner spaces
      "{{vm:abc}}", // missing node: prefix
      "node:vm:abc", // no braces
    ]) {
      expect(parseNodeToken(bad), bad).toBeNull();
    }
  });
});

describe("splitTextOnToken", () => {
  it("returns a single text segment when there is no token", () => {
    expect(splitTextOnToken("just some prose")).toEqual([{ type: "text", value: "just some prose" }]);
  });

  it("splits a token adjacent to surrounding text", () => {
    expect(splitTextOnToken("before {{node:device:d1}} after")).toEqual([
      { type: "text", value: "before " },
      { type: "embed", kind: "device", id: "d1" },
      { type: "text", value: " after" },
    ]);
  });

  it("returns only the embed when the token fills the whole string", () => {
    expect(splitTextOnToken("{{node:service:s1}}")).toEqual([
      { type: "embed", kind: "service", id: "s1" },
    ]);
  });

  it("handles multiple tokens on one line, including directly adjacent ones", () => {
    expect(splitTextOnToken("{{node:vm:a}}{{node:container:b}} and {{node:network:c}}")).toEqual([
      { type: "embed", kind: "vm", id: "a" },
      { type: "embed", kind: "container", id: "b" },
      { type: "text", value: " and " },
      { type: "embed", kind: "network", id: "c" },
    ]);
  });

  it("does not match ordinary double-brace text (no false positives)", () => {
    for (const text of [
      "use {{ mustache }} syntax",
      "config {{foo}} value",
      "{{node:foo:bar}}", // invalid kind stays literal
      "{{node:vm}}", // no id stays literal
      "{{node:vm:}}", // empty id stays literal
    ]) {
      expect(splitTextOnToken(text), text).toEqual([{ type: "text", value: text }]);
    }
  });
});

describe("nodeEmbedHref", () => {
  it("maps each kind to its detail route", () => {
    expect(nodeEmbedHref("device", "d1")).toBe("/inventory/hosts/d1");
    expect(nodeEmbedHref("vm", "v1")).toBe("/inventory/vms/v1");
    expect(nodeEmbedHref("container", "c1")).toBe("/inventory/containers/c1");
    expect(nodeEmbedHref("network", "n1")).toBe("/network/n1");
    expect(nodeEmbedHref("service", "s1")).toBe("/inventory/services/s1");
  });
});

describe("summary builders", () => {
  it("builds a device summary with no power and formatted memory", () => {
    const summary = buildDeviceSummary({
      id: "d1",
      name: "dixie",
      status: "ACTIVE",
      kind: "hypervisor",
      manufacturer: "Dell",
      model: "R720",
      osName: "Proxmox VE",
      osVersion: "8.2",
      memoryBytes: 137_438_953_472, // 128 GiB
    });
    expect(summary).toMatchObject({
      kind: "device",
      href: "/inventory/hosts/d1",
      status: "ACTIVE",
      power: null,
    });
    expect(summary.facts).toEqual([
      { label: "Type", value: "hypervisor" },
      { label: "OS", value: "Proxmox VE 8.2" },
      { label: "Hardware", value: "Dell R720" },
      { label: "Memory", value: "128 GiB" },
    ]);
  });

  it("builds a vm summary carrying power and host, dropping empty facts", () => {
    const summary = buildVmSummary({
      id: "v1",
      name: "gitea",
      status: "STALE",
      powerState: "RUNNING",
      host: { name: "dixie" },
      cpuCores: 4,
      memoryBytes: null,
      osName: null,
    });
    expect(summary.power).toBe("RUNNING");
    expect(summary.status).toBe("STALE");
    expect(summary.facts).toEqual([
      { label: "Host", value: "dixie" },
      { label: "vCPU", value: "4" },
    ]);
  });

  it("builds a container summary with runtime and power", () => {
    const summary = buildContainerSummary({
      id: "c1",
      name: "pihole",
      status: "ACTIVE",
      powerState: "STOPPED",
      runtime: "lxc",
      host: { name: "dixie" },
      memoryBytes: 536_870_912, // 512 MiB
    });
    expect(summary.power).toBe("STOPPED");
    expect(summary.facts).toEqual([
      { label: "Runtime", value: "lxc" },
      { label: "Host", value: "dixie" },
      { label: "Memory", value: "512 MiB" },
    ]);
  });

  it("builds a network summary, omitting a null vlan", () => {
    const summary = buildNetworkSummary({
      id: "n1",
      name: "Main LAN",
      status: "ACTIVE",
      cidr: "10.0.1.0/24",
      vlanId: null,
      gateway: "10.0.1.1",
    });
    expect(summary.power).toBeNull();
    expect(summary.facts).toEqual([
      { label: "CIDR", value: "10.0.1.0/24" },
      { label: "Gateway", value: "10.0.1.1" },
    ]);
  });

  it("builds a service summary with owner and port/protocol", () => {
    const summary = buildServiceSummary({
      id: "s1",
      name: "Gitea",
      status: "ACTIVE",
      url: "https://git.lab.example",
      port: 3000,
      protocol: "http",
      device: null,
      vm: { name: "gitea" },
      container: null,
    });
    expect(summary.facts).toEqual([
      { label: "URL", value: "git.lab.example" },
      { label: "Port", value: "3000/http" },
      { label: "On", value: "gitea" },
    ]);
  });
});
