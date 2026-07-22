import { MarkerType, type Edge } from "@xyflow/react";
import { formatBps } from "@/lib/format";
import { edgeRateBps, rateStrokeBonus } from "@/lib/topology/bandwidth-join";
import { cidrContains, isPrivateAddress } from "@/lib/topology/access";
import type { EdgeDetail } from "@/components/topology/edge-details";
import {
  pveNodeId,
  resolverAddress,
  splitTailscaleDestination,
  tailscaleConnectivitySummary,
  tailscaleSelectorDevices,
  type TailscaleMapDevice,
} from "./flow-utils";
import type { MapEndpoint } from "./nodes";
import type { BuildEdgesInput } from "./edge-context";
import { buildCloudflareEdges } from "./cloudflare-edges";
import {
  EDGE_LABEL_DEFAULTS,
  createEdgeOpacity,
} from "./edge-presentation";

export function buildEdges({
  graph, cloudflare, tailscale, pve, pveHomeNetworkId, selectedEdgeId,
  selectedNodeId, bandwidth, names, endpointsByNetwork, endpointsByAsset,
  allEndpoints, peerConnections, gatesByNetwork, cloudflareAppTargets,
  routeFor, switches, wifiAps,
}: BuildEdgesInput): { edges: Edge[]; details: Map<string, EdgeDetail> } {
  const details = new Map<string, EdgeDetail>();
  const edges: Edge[] = [];
  const networkNodeIds = new Set(graph.nodes.map((node) => node.id));
  const labelDefaults = EDGE_LABEL_DEFAULTS;
  const dimmed = createEdgeOpacity(selectedEdgeId, selectedNodeId);

  const cloudflareEdges = buildCloudflareEdges({
    graph,
    cloudflare,
    cloudflareAppTargets,
    routeFor,
    opacityFor: dimmed,
  });
  edges.push(...cloudflareEdges.edges);
  const collectCloudflareDetails = () => {
  for (const [id, detail] of cloudflareEdges.details) details.set(id, detail);
  };
  collectCloudflareDetails();

  const createEndpointEdges = () => {
  for (const [networkId, endpoints] of endpointsByNetwork) {
    for (const endpoint of endpoints) {
      const id = `${endpoint.id}->${networkId}`;
      edges.push({
        id,
        source: endpoint.id,
        target: networkId,
        targetHandle: "delivery-in",
        type: "routed",
        data: {
          ...routeFor(endpoint.id, networkId, "delivery"),
          relationship: "endpoint-membership",
        },
        style: {
          stroke: "var(--topology-edge-muted)",
          strokeWidth: 1.25,
          opacity: dimmed(id, endpoint.id, networkId),
        },
      });
      details.set(id, {
        title: `${endpoint.name} → ${names.get(networkId) ?? networkId}`,
        rows: [
          {
            primary: `${endpoint.kind} network attachment`,
            secondary: endpoint.ips.join(", "),
          },
        ],
      });
    }
  }
  };
  createEndpointEdges();

  // A canonical asset can have a LAN endpoint and a Tailscale endpoint. Join
  // those instances with a neutral identity trace; this is not an allow rule.
  const createIdentityEdges = () => {
  for (const endpoints of endpointsByAsset.values()) {
    if (endpoints.length < 2) continue;
    const ordered = [...endpoints].sort((a, b) => a.networkId.localeCompare(b.networkId));
    for (let index = 1; index < ordered.length; index += 1) {
      const source = ordered[0];
      const target = ordered[index];
      const id = `identity:${source.assetId}:${source.networkId}->${target.networkId}`;
      edges.push({
        id,
        source: source.id,
        target: target.id,
        type: "routed",
        data: { ...routeFor(source.id, target.id, "delivery"), relationship: "same-asset" },
        label: "same device",
        style: {
          stroke: "var(--color-muted-foreground)",
          strokeWidth: 1.1,
          strokeDasharray: "3 4",
          opacity: dimmed(id, source.id, target.id),
        },
        ...labelDefaults,
      });
      details.set(id, {
        title: `${source.name} · shared identity`,
        rows: [{
          primary: "The same PolySIEM asset was observed on both networks",
          secondary: "Identity evidence only — this line does not claim packet access",
        }],
      });
    }
  }
  };
  createIdentityEdges();

  // Subnet and exit-node advertisements show the path the overlay can use to
  // enter another network. Approved routes are solid; merely advertised ones
  // remain dashed so the map does not overstate current reachability.
  const createTailscaleEdges = () => {
  for (const tailnet of tailscale) {
    const overlayNetworkId = `tailscale:${tailnet.integrationId}`;
    const createDeviceRoutes = () => {
    const routePresentation = (active: boolean) => ({
      markerEnd: active
        ? { type: MarkerType.ArrowClosed, color: "var(--color-chart-4)", width: 14, height: 14 }
        : undefined,
      style: {
        stroke: active ? "var(--color-chart-4)" : "var(--color-warning)",
        strokeWidth: active ? 1.8 : 1.25,
        strokeDasharray: active ? undefined : "5 4",
      },
    });
    for (const device of tailnet.devices) {
      if (!device.assetId) continue;
      const source = (endpointsByAsset.get(device.assetId) ?? []).find(
        (endpoint) => endpoint.networkId === overlayNetworkId,
      );
      if (!source) continue;
      const enabled = new Set(device.enabledRoutes);
      const routes = [...new Set([...device.enabledRoutes, ...device.advertisedRoutes])];
      for (const route of routes) {
        const routeAddress = route.split("/")[0];
        const routeTarget = () => route === "0.0.0.0/0" || route === "::/0"
          ? graph.nodes.find((node) => node.kind === "internet")
          : graph.nodes.find(
              (node) =>
                node.kind === "network" &&
                node.id !== overlayNetworkId &&
                node.cidr &&
                (node.cidr.toLowerCase() === route.toLowerCase() || cidrContains(node.cidr, routeAddress)),
            );
        const target = routeTarget();
        if (!target) continue;
        const active = enabled.has(route);
        const presentation = routePresentation(active);
        const id = `tailscale:route:${tailnet.integrationId}:${device.id}:${route}`;
        edges.push({
          id,
          source: source.id,
          target: target.id,
          targetHandle: target.kind === "network" ? "delivery-in" : undefined,
          type: "routed",
          data: { ...routeFor(source.id, target.id, "delivery"), relationship: "overlay-route" },
          label: `${route} · ${active ? "enabled" : "advertised"}`,
          markerEnd: presentation.markerEnd,
          style: {
            ...presentation.style,
            opacity: dimmed(id, source.id, target.id),
          },
          ...labelDefaults,
        });
        details.set(id, {
          title: `${device.name} → ${target.name}`,
          rows: [{
            primary: `${active ? "Enabled" : "Advertised, not enabled"} Tailscale route ${route}`,
            secondary: [
              `Tailscale API · captured ${new Date(tailnet.capturedAt).toLocaleString()}`,
              device.tags.join(", ") || null,
              device.online === false ? "device offline" : null,
              tailscaleConnectivitySummary(device),
            ].filter(Boolean).join(" · "),
            status: active && device.online !== false ? "ok" : undefined,
          }],
        });
      }
    }
    };
    createDeviceRoutes();

    const endpointForDevice = (device: TailscaleMapDevice): MapEndpoint | null => {
      if (!device.assetId) return null;
      return (endpointsByAsset.get(device.assetId) ?? []).find(
        (endpoint) => endpoint.networkId === overlayNetworkId,
      ) ?? null;
    };

    // Tailnet membership alone does not imply reachability. Draw a directed
    // peer path only when a captured grant/ACL resolves both endpoints.
    let policyEdgeCount = 0;
    const createPolicyGrants = () => {
    for (const [ruleIndex, rule] of (tailnet.policy?.rules ?? []).entries()) {
      if (rule.action.toLowerCase() !== "accept" || policyEdgeCount >= 5_000) continue;
      const sourceDevices = [...new Map(
        rule.sources.flatMap((selector) => tailscaleSelectorDevices(selector, tailnet))
          .map((device) => [device.id, device]),
      ).values()];
      for (const destination of rule.destinations) {
        const destinationSpec = splitTailscaleDestination(destination);
        const destinationDevices = tailscaleSelectorDevices(destinationSpec.selector, tailnet);
        for (const sourceDevice of sourceDevices) {
          const source = endpointForDevice(sourceDevice);
          if (!source) continue;
          for (const targetDevice of destinationDevices) {
            const connectPolicyDevices = () => {
            if (
              sourceDevice.id === targetDevice.id ||
              targetDevice.blocksIncomingConnections ||
              policyEdgeCount >= 5_000
            ) return;
            const target = endpointForDevice(targetDevice);
            if (!target) return;
            const id = `tailscale:policy:${tailnet.integrationId}:${ruleIndex}:${sourceDevice.id}->${targetDevice.id}:${destination}`;
            const protocol = rule.protocols.length > 0 ? rule.protocols.join(", ") : "any protocol";
            const packetClass = destinationSpec.ports
              ? `${protocol} · ${destinationSpec.ports}`
              : protocol;
            edges.push({
              id,
              source: source.id,
              target: target.id,
              type: "routed",
              data: { ...routeFor(source.id, target.id, "peer", id), relationship: "overlay-policy" },
              label: packetClass,
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: "var(--color-indigo-500, #6366f1)",
                width: 13,
                height: 13,
              },
              style: {
                stroke: "var(--color-indigo-500, #6366f1)",
                strokeWidth: 1.55,
                opacity: dimmed(id, source.id, target.id),
              },
              ...labelDefaults,
            });
            details.set(id, {
              title: `${sourceDevice.name} → ${targetDevice.name}`,
              rows: [{
                primary: `Allowed by Tailscale ${rule.kind} · ${packetClass}`,
                secondary: [
                  `Policy selectors ${rule.sources.join(", ")} → ${destination}`,
                  rule.via.length > 0 ? `via ${rule.via.join(", ")}` : null,
                  sourceDevice.online === false ? "source offline" : null,
                  targetDevice.online === false ? "destination offline" : null,
                  tailscaleConnectivitySummary(targetDevice),
                  `captured ${new Date(tailnet.capturedAt).toLocaleString()}`,
                ].filter(Boolean).join(" · "),
                status: sourceDevice.online !== false && targetDevice.online !== false ? "ok" : undefined,
              }],
            });
            policyEdgeCount += 1;
            };
            connectPolicyDevices();
          }
        }
      }
    }
    };
    createPolicyGrants();

    const internet = graph.nodes.find((node) => node.kind === "internet");
    const dnsEntries = [
      ...tailnet.dns.nameservers.map((nameserver) => ({ domain: "default DNS", nameserver })),
      ...tailnet.dns.splitDns.flatMap((route) =>
        route.nameservers.map((nameserver) => ({ domain: route.domain, nameserver })),
      ),
    ];
    const seenDnsEdges = new Set<string>();
    const createDnsRoutes = () => {
    for (const entry of dnsEntries) {
      const address = resolverAddress(entry.nameserver);
      if (!address) continue;
      const endpoint = allEndpoints.find((candidate) => candidate.ips.includes(address));
      const network = graph.nodes.find(
        (node) => node.kind === "network" && node.cidr && cidrContains(node.cidr, address),
      );
      const publicAddress = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address) && !isPrivateAddress(address);
      const target = endpoint
        ? { id: endpoint.id, name: endpoint.name, kind: "endpoint" as const }
        : network
          ? { id: network.id, name: network.name, kind: "network" as const }
          : publicAddress && internet
            ? { id: internet.id, name: internet.name, kind: "internet" as const }
            : null;
      if (!target || target.id === overlayNetworkId) continue;
      const key = `${entry.domain}|${entry.nameserver}|${target.id}`;
      if (seenDnsEdges.has(key)) continue;
      seenDnsEdges.add(key);
      const id = `tailscale:dns:${tailnet.integrationId}:${key}`;
      edges.push({
        id,
        source: overlayNetworkId,
        target: target.id,
        targetHandle: target.kind === "network" ? "delivery-in" : undefined,
        type: "routed",
        data: { ...routeFor(overlayNetworkId, target.id, "delivery"), relationship: "dns-route" },
        label: `${entry.domain} → ${entry.nameserver}`,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "var(--color-info)",
          width: 12,
          height: 12,
        },
        style: {
          stroke: "var(--color-info)",
          strokeWidth: 1.25,
          strokeDasharray: "3 4",
          opacity: dimmed(id, overlayNetworkId, target.id),
        },
        ...labelDefaults,
      });
      details.set(id, {
        title: `${entry.domain} DNS → ${target.name}`,
        rows: [{
          primary: `Tailscale DNS resolver ${entry.nameserver}`,
          secondary: [
            tailnet.dns.magicDns === true ? "MagicDNS enabled" : null,
            tailnet.dns.searchDomains.length > 0
              ? `search ${tailnet.dns.searchDomains.join(", ")}`
              : null,
            `captured ${new Date(tailnet.capturedAt).toLocaleString()}`,
          ].filter(Boolean).join(" · "),
        }],
      });
    }
    };
    createDnsRoutes();

    // App connector definitions identify which tailnet devices are entry
    // points for configured domains/routes without pretending the definition
    // itself is a broad allow rule.
    const createAppConnectors = () => {
    for (const [connectorIndex, connector] of (tailnet.policy?.appConnectors ?? []).entries()) {
      const connectorDevices = [...new Map(
        connector.connectors.flatMap((selector) => tailscaleSelectorDevices(selector, tailnet))
          .map((device) => [device.id, device]),
      ).values()];
      for (const device of connectorDevices) {
        const target = endpointForDevice(device);
        if (!target) continue;
        const id = `tailscale:connector:${tailnet.integrationId}:${connectorIndex}:${device.id}`;
        edges.push({
          id,
          source: overlayNetworkId,
          target: target.id,
          type: "routed",
          data: { ...routeFor(overlayNetworkId, target.id, "delivery"), relationship: "app-connector" },
          label: connector.name,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "var(--color-chart-5)",
            width: 12,
            height: 12,
          },
          style: {
            stroke: "var(--color-chart-5)",
            strokeWidth: 1.4,
            strokeDasharray: "6 3 1 3",
            opacity: dimmed(id, overlayNetworkId, target.id),
          },
          ...labelDefaults,
        });
        details.set(id, {
          title: `${connector.name} → ${device.name}`,
          rows: [{
            primary: "Tailscale app connector entry point",
            secondary: [
              connector.domains.length > 0 ? `domains ${connector.domains.join(", ")}` : null,
              connector.routes.length > 0 ? `routes ${connector.routes.join(", ")}` : null,
              tailscaleConnectivitySummary(device),
            ].filter(Boolean).join(" · "),
            status: device.online === false ? undefined : "ok",
          }],
        });
      }
    }
    };
    createAppConnectors();
  }
  };
  createTailscaleEdges();

  const createGateEdges = () => {
  for (const node of graph.nodes) {
    const gateId = gatesByNetwork.get(node.id);
    if (!gateId) continue;
    const id = `gate:${node.id}`;
    edges.push({
      id,
      source: node.id,
      target: gateId,
      sourceHandle: "trace-out",
      targetHandle: "vlan-in",
      type: "routed",
      data: { ...routeFor(node.id, gateId, "delivery") },
      markerStart: {
        type: MarkerType.ArrowClosed,
        color: "var(--color-info)",
        width: 13,
        height: 13,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "var(--color-info)",
        width: 13,
        height: 13,
      },
      style: {
        stroke: "var(--color-info)",
        strokeWidth: 1.4,
        opacity: dimmed(id, node.id, gateId),
      },
    });
    const gateBandwidth = node.interfaceKey
      ? bandwidth?.interfaceByKey.get(node.interfaceKey)
      : undefined;
    details.set(id, {
      title: `${node.name} ↔ OPNsense ${node.interfaceKey}`,
      rows: [
        {
          primary: "Inter-VLAN routing boundary",
          secondary: [
            node.gateway ?? "gateway address not reported",
            "OPNsense interface",
          ].join(" · "),
          ...(gateBandwidth &&
          (gateBandwidth.inBps > 0 || gateBandwidth.outBps > 0)
            ? {
                badge: formatBps(
                  gateBandwidth.inBps + gateBandwidth.outBps,
                ),
              }
            : {}),
        },
      ],
    });
  }
  };
  createGateEdges();

  const createPeerEdges = () => {
  for (const peer of peerConnections) {
    const selected = peer.id === selectedEdgeId;
    edges.push({
      id: peer.id,
      source: peer.source,
      target: peer.target,
      sourceHandle: "peer-out",
      targetHandle: "peer-in",
      type: "routed",
      data: {
        ...routeFor(peer.source, peer.target, "peer", peer.id),
        fixedTraceLane: true,
        casingGap: 4,
        policyGroupNodeId: peer.groupNodeId,
      },
      label: selected ? peer.group : undefined,
      markerStart: {
        type: MarkerType.ArrowClosed,
        color: "var(--color-chart-3)",
        width: 13,
        height: 13,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "var(--color-chart-3)",
        width: 13,
        height: 13,
      },
      style: {
        stroke: "var(--color-chart-3)",
        strokeWidth: selected ? 2.6 : 1.5,
        opacity: dimmed(peer.id, peer.source, peer.target),
      },
      ...labelDefaults,
    });
    details.set(peer.id, {
      title: `${names.get(peer.source) ?? peer.source} ↔ ${names.get(peer.target) ?? peer.target}`,
      rows: [
        {
          primary: `${peer.group} peer access`,
          secondary:
            "Proxmox · direct bidirectional communication allowed between these workloads",
          status: "ok",
        },
      ],
    });
  }
  };
  createPeerEdges();

  const createPolicyEdges = () => {
  const policyLabel = (label: string, rateBps: number) => {
    if (rateBps > 0) return `${label === "all" ? "ANY" : label.toUpperCase()} · ${formatBps(rateBps)}`;
    return label === "all" ? "ANY packet" : label.toUpperCase();
  };
  for (const edge of graph.edges) {
    const selected = edge.id === selectedEdgeId;
    const routedSource = gatesByNetwork.get(edge.source) ?? edge.source;
    const routedTarget = gatesByNetwork.get(edge.target) ?? edge.target;
    // Live bandwidth through this path = the summed rates of the rules it
    // aggregates (rule uuid = pf counter label). Zero/unknown stays unlabeled.
    const rateBps = bandwidth
      ? edgeRateBps(edge.rules, bandwidth.ruleRates)
      : 0;
    edges.push({
      id: edge.id,
      source: routedSource,
      target: routedTarget,
      type: "routed",
      sourceHandle: gatesByNetwork.has(edge.source) ? "route-out" : "trace-out",
      targetHandle: gatesByNetwork.has(edge.target) ? "route-in" : "trace-in",
      data: {
        ...routeFor(routedSource, routedTarget, "trace", edge.id),
        fixedTraceLane: true,
        casingGap: 4.5,
      },
      label: policyLabel(edge.label, rateBps),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "var(--color-success)",
        width: 16,
        height: 16,
      },
      style: {
        stroke: "var(--color-success)",
        strokeWidth: (selected ? 2.75 : 1.75) + rateStrokeBonus(rateBps),
        opacity: dimmed(edge.id, edge.source, edge.target),
      },
      ...labelDefaults,
    });
    details.set(edge.id, {
      title: `${names.get(edge.source) ?? edge.source} → ${names.get(edge.target) ?? edge.target}`,
      rows: [
        {
          primary: `Possible packet: ${edge.label === "all" ? "any protocol / port" : edge.label}`,
          secondary: `Routed policy traversal · ${edge.rules.length} supporting rule${edge.rules.length === 1 ? "" : "s"}`,
          ...(rateBps > 0 ? { badge: formatBps(rateBps) } : {}),
        },
        ...edge.rules.map((rule) => {
          const bw = rule.externalId
            ? bandwidth?.ruleById.get(rule.externalId)
            : undefined;
          const evidenceSource = rule.evidenceSource
            ? rule.evidenceSource
                .toLowerCase()
                .replace(/^./, (character) => character.toUpperCase())
            : "firewall policy";
          return {
            primary: rule.description,
            secondary: [
              evidenceSource,
              (rule.protocol ?? "any").toUpperCase(),
              rule.ports ? `destination ${rule.ports}` : "all ports",
              rule.sequence !== null ? `seq ${rule.sequence}` : null,
            ]
              .filter(Boolean)
              .join(" · "),
            ...(bw && bw.totalBytes > 0
              ? {
                  badge: formatBps(bw.avgBps),
                  spark: bw.series.map((point) => point.bps),
                }
              : {}),
          };
        }),
      ],
    });
  }
  };
  createPolicyEdges();

  const createSwitchEdges = () => {
  for (const sw of switches) {
    for (const carried of sw.carried) {
      if (!names.has(carried.networkId)) continue;
      const id = `switch:${sw.deviceId}->${carried.networkId}`;
      edges.push({
        id,
        source: `switch:${sw.deviceId}`,
        target: carried.networkId,
        targetHandle: "delivery-in",
        type: "routed",
        data: {
          ...routeFor(`switch:${sw.deviceId}`, carried.networkId, "delivery"),
        },
        label: `${carried.ports} port${carried.ports === 1 ? "" : "s"}`,
        style: {
          stroke: "var(--color-warning)",
          strokeWidth: 1.5,
          strokeDasharray: "6 4",
          opacity: dimmed(id, `switch:${sw.deviceId}`, carried.networkId),
        },
        ...labelDefaults,
      });
      details.set(id, {
        title: `${sw.name} carries ${names.get(carried.networkId)}`,
        rows: [
          {
            primary: "Layer-2 delivery",
            secondary: `Switch configuration · ${carried.ports} port(s)/LAG(s) carry this VLAN`,
          },
        ],
      });
    }
  }
  };
  createSwitchEdges();

  const createWifiEdges = () => {
  for (const ap of wifiAps) {
    const source = `wifiap:${ap.id}`;
    if (!names.has(source)) continue;
    for (const networkId of ap.networkIds) {
      if (!names.has(networkId)) continue;
      const id = `${source}->${networkId}`;
      edges.push({
        id,
        source,
        target: networkId,
        targetHandle: "delivery-in",
        type: "routed",
        data: { ...routeFor(source, networkId, "delivery") },
        label: "WiFi",
        style: {
          stroke: "var(--color-info)",
          strokeWidth: 1.5,
          strokeDasharray: "2 3",
          opacity: dimmed(id, source, networkId),
        },
        ...labelDefaults,
      });
      details.set(id, {
        title: `${ap.name} serves ${names.get(networkId)}`,
        rows: [
          {
            primary: "Wireless delivery",
            secondary:
              "Wireless integration · SSIDs on this AP bridge into this VLAN",
          },
        ],
      });
    }
  }
  };
  createWifiEdges();

  const createPveEdges = () => {
  if (pve) {
    const edgeTargets = new Set<string>();
    for (const edge of pve.edges) {
      const source = pveNodeId(edge.from);
      const target = pveNodeId(edge.to);
      if (!names.has(source) || !names.has(target)) continue;
      edgeTargets.add(target);
      const selected = edge.id === selectedEdgeId;
      const note =
        edge.from.type === "network" && edge.from.note
          ? ` (${edge.from.note})`
          : "";
      edges.push({
        id: edge.id,
        source,
        target,
        sourceHandle: networkNodeIds.has(source) ? "trace-out" : undefined,
        type: "routed",
        data: { ...routeFor(source, target, "policy") },
        label: edge.label,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "var(--color-chart-3)",
          width: 16,
          height: 16,
        },
        style: {
          stroke: "var(--color-chart-3)",
          strokeWidth: selected ? 2.5 : 1.5,
          opacity: dimmed(edge.id, source, target),
        },
        ...labelDefaults,
      });
      details.set(edge.id, {
        title: `${names.get(source) ?? source}${note} → ${names.get(target) ?? target}`,
        rows: edge.descriptions.map((description) => ({
          primary: description,
          secondary: `Proxmox · ${edge.label}`,
        })),
      });
    }
    // Anchor otherwise-floating nodes (pure peer groups) to their VLAN with a
    // faint containment line so they don't hang unexplained in space.
    const createContainmentEdges = () => {
    if (pveHomeNetworkId && names.has(pveHomeNetworkId)) {
      const anchorable = [
        ...(pve.baseline ? ["pve:baseline"] : []),
        ...pve.groups.map((group) => `pve:grp:${group.name}`),
      ];
      for (const id of anchorable) {
        if (edgeTargets.has(id)) continue;
        edges.push({
          id: `contain:${id}`,
          source: pveHomeNetworkId,
          target: id,
          sourceHandle: "trace-out",
          type: "routed",
          data: { ...routeFor(pveHomeNetworkId, id, "policy") },
          style: {
            stroke: "var(--topology-edge-muted)",
            strokeWidth: 1.25,
            strokeDasharray: "2 4",
            opacity: dimmed(`contain:${id}`, pveHomeNetworkId, id),
          },
        });
        details.set(`contain:${id}`, {
          title: `${names.get(id)} lives in ${names.get(pveHomeNetworkId)}`,
          rows: [
            {
              primary: "Containment",
              secondary: "guests of this group live in this VLAN",
            },
          ],
        });
      }
    }
    };
    createContainmentEdges();
  }
  };
  createPveEdges();
  return { edges, details };
}
