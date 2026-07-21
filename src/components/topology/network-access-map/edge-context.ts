import type { DagreRoute } from "@/lib/topology/edge-routing";
import type { AccessGraph } from "@/lib/topology/access";
import type { PveAccessView } from "@/lib/topology/pve-access";
import type { BandwidthData } from "@/components/topology/use-bandwidth";
import type { MapEndpoint } from "./nodes";
import type {
  CloudflareMapAccount,
  MapSwitch,
  MapWifiAp,
  TailscaleMapTailnet,
} from "./types";

type RouteKind = "trace" | "peer" | "delivery" | "policy";
type PeerConnection = {
  id: string;
  group: string;
  groupNodeId: string;
  source: string;
  target: string;
};
type CloudflareTarget = {
  id: string;
  name: string;
  kind: "endpoint" | "network";
};

export interface BuildEdgesInput {
  graph: AccessGraph;
  cloudflare: CloudflareMapAccount[];
  tailscale: TailscaleMapTailnet[];
  pve: PveAccessView | null;
  pveHomeNetworkId: string | null;
  selectedEdgeId: string | null;
  selectedNodeId: string | null;
  bandwidth: BandwidthData | null;
  names: Map<string, string>;
  endpointsByNetwork: Map<string, MapEndpoint[]>;
  endpointsByAsset: Map<string, MapEndpoint[]>;
  allEndpoints: MapEndpoint[];
  peerConnections: PeerConnection[];
  gatesByNetwork: Map<string, string>;
  cloudflareAppTargets: Map<string, CloudflareTarget>;
  routeFor: (
    source: string,
    target: string,
    kind: RouteKind,
    edgeId?: string,
  ) => DagreRoute;
  switches: MapSwitch[];
  wifiAps: MapWifiAp[];
}
