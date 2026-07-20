import "server-only";
import type { IntegrationType } from "@prisma/client";
import type { IntegrationDriver } from "./types";
import { proxmoxDriver } from "./proxmox";
import { opnsenseDriver } from "./opnsense";
import { elasticsearchDriver } from "./elasticsearch";
import { unifiDriver } from "./unifi";
import { otxDriver } from "./otx";
import { cloudflareDriver } from "./cloudflare";
import { tailscaleDriver } from "./tailscale";
import { edgeNatDriver } from "./edge-nat";
import { censysDriver } from "./censys";
import { securityTrailsDriver } from "./securitytrails";

/** Registry mapping integration types to their drivers. FROZEN — driver
 *  implementations live in their own directories and keep these export names. */
const DRIVERS: Record<IntegrationType, IntegrationDriver> = {
  PROXMOX: proxmoxDriver,
  OPNSENSE: opnsenseDriver,
  ELASTICSEARCH: elasticsearchDriver,
  UNIFI: unifiDriver,
  OTX: otxDriver,
  CLOUDFLARE: cloudflareDriver,
  TAILSCALE: tailscaleDriver,
  EDGE_NAT_SERVER: edgeNatDriver,
  CENSYS: censysDriver,
  SECURITYTRAILS: securityTrailsDriver,
};

export function getDriver(type: IntegrationType): IntegrationDriver {
  return DRIVERS[type];
}

export { toDriverConfig } from "./config";
export type { DriverConfig, IntegrationDriver, TestResult } from "./types";
