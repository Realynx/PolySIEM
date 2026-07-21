import { MarkerType, type Edge } from "@xyflow/react";
import type { EdgeDetail } from "@/components/topology/edge-details";
import { cidrContains } from "@/lib/topology/access";
import type { BuildEdgesInput } from "./edge-context";
import {
  EDGE_LABEL_DEFAULTS,
  type EdgeOpacity,
} from "./edge-presentation";

type CloudflareEdgesInput = Pick<
  BuildEdgesInput,
  "graph" | "cloudflare" | "cloudflareAppTargets" | "routeFor"
> & { opacityFor: EdgeOpacity };

/** Build the Cloudflare account, published-app, origin, and private-route edges. */
export function buildCloudflareEdges({
  graph,
  cloudflare,
  cloudflareAppTargets,
  routeFor,
  opacityFor,
}: CloudflareEdgesInput): { edges: Edge[]; details: Map<string, EdgeDetail> } {
  const edges: Edge[] = [];
  const details = new Map<string, EdgeDetail>();

  // Unmatched services intentionally stop at the hostname node; targeting an
  // entire VLAN would assert a path for which there is no origin evidence.
  for (const account of cloudflare) {
    const accountId = `cloudflare:account:${account.integrationId}`;
    for (const application of account.applications) {
      const appId = `cloudflare:app:${account.integrationId}:${application.id}`;
      const publishId = `cloudflare:publish:${account.integrationId}:${application.id}`;
      edges.push({
        id: publishId,
        source: accountId,
        target: appId,
        type: "routed",
        data: {
          ...routeFor(accountId, appId, "delivery"),
          relationship: "cloudflare-publish",
          cloudflareAppId: appId,
        },
        label: application.tunnelName,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "var(--color-info)",
          width: 14,
          height: 14,
        },
        style: {
          stroke: "var(--color-info)",
          strokeWidth: 1.5,
          opacity: opacityFor(publishId, accountId, appId),
        },
        ...EDGE_LABEL_DEFAULTS,
      });
      details.set(publishId, {
        title: `${account.accountName} → ${application.hostname}`,
        rows: [{
          primary: `Published through ${application.tunnelName}`,
          secondary: `Cloudflare API · tunnel ${application.tunnelStatus} · captured ${new Date(account.capturedAt).toLocaleString()}`,
          status: application.tunnelStatus === "healthy" ? "ok" : undefined,
        }],
      });

      const target = cloudflareAppTargets.get(appId);
      if (target) {
        const originId = `cloudflare:origin:${account.integrationId}:${application.id}`;
        edges.push({
          id: originId,
          source: appId,
          target: target.id,
          type: "routed",
          data: {
            ...routeFor(appId, target.id, "delivery"),
            relationship: "cloudflare-origin",
            cloudflareAppId: appId,
          },
          label: application.path ? `${application.path} · origin` : "origin",
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "var(--color-chart-2)",
            width: 14,
            height: 14,
          },
          style: {
            stroke: "var(--color-chart-2)",
            strokeWidth: 1.6,
            opacity: opacityFor(originId, appId, target.id),
          },
          ...EDGE_LABEL_DEFAULTS,
        });
        details.set(originId, {
          title: `${application.hostname} → ${target.name}`,
          rows: [{
            primary: application.service,
            secondary: `Cloudflare tunnel ingress · matched ${target.kind}`,
            status: "ok",
          }],
        });
      }
    }

    for (const route of account.privateRoutes) {
      const routeAddress = route.network.split("/")[0];
      const target = graph.nodes.find(
        (node) =>
          node.kind === "network" &&
          node.cidr &&
          (node.cidr.toLowerCase() === route.network.toLowerCase() ||
            cidrContains(node.cidr, routeAddress)),
      );
      if (!target) continue;
      const id = `cloudflare:private:${account.integrationId}:${route.id}`;
      edges.push({
        id,
        source: accountId,
        target: target.id,
        targetHandle: "delivery-in",
        type: "routed",
        data: { ...routeFor(accountId, target.id, "delivery") },
        label: route.network,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "var(--color-chart-3)",
          width: 14,
          height: 14,
        },
        style: {
          stroke: "var(--color-chart-3)",
          strokeWidth: 1.5,
          strokeDasharray: "5 4",
          opacity: opacityFor(id, accountId, target.id),
        },
        ...EDGE_LABEL_DEFAULTS,
      });
      details.set(id, {
        title: `${account.accountName} → ${target.name}`,
        rows: [{
          primary: `Private route ${route.network}`,
          secondary: [
            "Cloudflare API",
            route.tunnelName,
            route.virtualNetworkName,
          ].filter(Boolean).join(" · "),
        }],
      });
    }
  }

  return { edges, details };
}
