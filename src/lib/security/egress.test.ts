import { describe, expect, it } from "vitest";
import { deriveAccessGraph, type AccessNetworkInput, type AccessRuleInput } from "@/lib/topology/access";
import { sshEgressTargets } from "./egress";

const networks: AccessNetworkInput[] = [
  { id: "srv", name: "Servers", vlanId: 10, cidr: "10.0.10.0/24", externalId: "opt1", purpose: null },
  { id: "mgmt", name: "Mgmt", vlanId: 99, cidr: "10.0.99.0/24", externalId: "opt2", purpose: null },
  { id: "iot", name: "IoT", vlanId: 20, cidr: "10.0.20.0/24", externalId: "opt3", purpose: null },
];

let seq = 0;
function rule(partial: Partial<AccessRuleInput>): AccessRuleInput {
  seq += 1;
  return {
    id: `r${seq}`,
    action: "PASS",
    enabled: true,
    sequence: seq,
    protocol: "tcp",
    sourceSpec: null,
    destSpec: null,
    destPort: null,
    descriptionText: null,
    ...partial,
  };
}

describe("sshEgressTargets", () => {
  it("lists other internal networks reachable on tcp/22", () => {
    const graph = deriveAccessGraph(
      networks,
      [
        rule({ sourceSpec: "10.0.10.0/24", destSpec: "10.0.99.0/24", destPort: "22" }),
        rule({ sourceSpec: "10.0.10.0/24", destSpec: "10.0.20.0/24", destPort: "443" }),
      ],
      [],
    );
    expect(sshEgressTargets(graph, ["srv"])).toEqual(["Mgmt"]);
    expect(sshEgressTargets(graph, ["iot"])).toEqual([]);
  });

  it("counts any-port rules and ignores the internet and the guest's own network", () => {
    const graph = deriveAccessGraph(
      networks,
      [rule({ sourceSpec: "10.0.20.0/24", destSpec: "any", protocol: null })],
      [],
    );
    expect(sshEgressTargets(graph, ["iot"])).toEqual(["Mgmt", "Servers"]);
  });

  it("ignores UDP-only rules", () => {
    const graph = deriveAccessGraph(
      networks,
      [rule({ sourceSpec: "10.0.10.0/24", destSpec: "10.0.99.0/24", protocol: "udp", destPort: "22" })],
      [],
    );
    expect(sshEgressTargets(graph, ["srv"])).toEqual([]);
  });
});
