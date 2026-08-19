/**
 * PolySIEM connectors — the Cloudflare-Tunnel-style reverse-tunnel agent.
 *
 * Pure generation only: nothing in here touches the database or the network.
 * The control plane (`src/lib/services/connectors.ts`) imports
 * {@link connectorRulesetHash} so the `configHash` it publishes is computed by
 * exactly the same code the on-host agent uses to verify what it parsed — and the
 * SSH transport (`./ssh.ts`) hashes its APPLY payload with the very same function,
 * so `configHash` means one thing on both transports.
 *
 * A connector is standalone and can serve MANY edge servers: a
 * {@link ConnectorRuleset} names the one interface it owns, one
 * {@link ConnectorTunnel} per linked edge (one WireGuard peer and one address
 * each), and every {@link ConnectorRoute} across all of those edges, each tagged
 * with the tunnel address of the edge that published it.
 */

export {
  CONNECTOR_AGENT_SCRIPT,
  CONNECTOR_AGENT_VERSION,
  CONNECTOR_AGENT_PATH,
  CONNECTOR_RULESET_VERSION,
  CONNECTOR_STATUS_BANNER,
  CONNECTOR_SSH_USERNAME,
  CONNECTOR_SUDOERS_PATH,
  CONNECTOR_CONFIG_DIR,
  CONNECTOR_CONFIG_FILE,
  CONNECTOR_TOKEN_FILE,
  CONNECTOR_PRIVATE_KEY_FILE,
  CONNECTOR_PUBLIC_KEY_FILE,
  CONNECTOR_TUNNEL_FILE,
  CONNECTOR_STATE_FILE,
  CONNECTOR_RULESET_FILE,
  CONNECTOR_SERVICE_NAME,
  CONNECTOR_DNAT_CHAIN,
  CONNECTOR_SNAT_CHAIN,
  CONNECTOR_FORWARD_CHAIN,
  CONNECTOR_DNAT_GENERATION_PREFIX,
  CONNECTOR_SNAT_GENERATION_PREFIX,
  CONNECTOR_FORWARD_GENERATION_PREFIX,
  canonicalConnectorRuleset,
  connectorRulesetHash,
  connectorRestrictedAuthorizedKey,
} from "./agent";

export type {
  ConnectorRoute,
  ConnectorTunnel,
  ConnectorRuleset,
  ConnectorEdgeParams,
  ConnectorConfigPayload,
} from "./agent";

export {
  CONNECTOR_SERVICE_PATH,
  buildConnectorInstallScript,
  buildConnectorInstallCommand,
  buildConnectorInstallErrorScript,
  normalizeConnectorBaseUrl,
  stripConnectorSshBlocks,
} from "./install";

export type { ConnectorInstallOptions } from "./install";
