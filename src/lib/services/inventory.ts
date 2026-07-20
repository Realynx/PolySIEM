import "server-only";

/**
 * Stable inventory service facade. Entity implementations live in cohesive
 * modules under ./inventory; callers keep importing this path unchanged.
 */
export {
  createDevice,
  deleteDevice,
  getDevice,
  listDevices,
  updateDevice,
} from "./inventory/devices";
export {
  createVm,
  deleteVm,
  getVm,
  listVms,
  updateVm,
} from "./inventory/virtual-machines";
export {
  createContainer,
  deleteContainer,
  getContainer,
  listContainers,
  updateContainer,
} from "./inventory/containers";
export {
  createNetwork,
  deleteNetwork,
  getNetwork,
  listNetworks,
  updateNetwork,
} from "./inventory/networks";
export {
  createIp,
  deleteIp,
  getIp,
  listIps,
  updateIp,
} from "./inventory/ip-addresses";
export {
  createService,
  deleteService,
  getService,
  listServices,
  updateService,
} from "./inventory/services";
export {
  createStoragePool,
  deleteStoragePool,
  getStoragePool,
  listStoragePools,
  updateStoragePool,
} from "./inventory/storage-pools";
export {
  listFirewallAliases,
  listFirewallRules,
  updateFirewallRuleAnnotation,
} from "./inventory/firewall";
export {
  listDhcpLeases,
  listNetworkNeighbors,
} from "./inventory/network-observations";
