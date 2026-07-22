import { isMock, type DriverConfig, type IntegrationDriver, type TestResult } from "../types";
import { testConnection } from "./client";
import { mockTestConnection } from "./mock";

/** Registry driver: test connection dispatches mock vs live automatically. */
export const otxDriver: IntegrationDriver = {
  async testConnection(cfg: DriverConfig): Promise<TestResult> {
    return isMock(cfg) ? mockTestConnection(cfg) : testConnection(cfg);
  },
};

export { otxFetch, fetchPulses, testConnection, type PulsePage } from "./client";
export { mockFetchPulses, mockIocHits, mockTestConnection } from "./mock";
export {
  extractDomainIocs,
  extractIpIocs,
  isPublicIpv4,
  isValidDomain,
  normalizeIndicators,
  toPulseView,
  MAX_DOMAIN_IOCS,
  MAX_MATCH_IOCS,
  PULSE_INDICATOR_CAP,
  type IocCandidate,
} from "./normalize";
export { generateSuricataRules, sanitizeMsg, type SuricataRuleset } from "./suricata-rules";
