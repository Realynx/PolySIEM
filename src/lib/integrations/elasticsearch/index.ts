import type { DriverConfig, IntegrationDriver, TestResult } from "../types";
import { isMock } from "../types";
import { testConnection } from "./client";
import { mockTestConnection } from "./mock";

/** Registry driver: test connection dispatches mock vs live automatically. */
export const elasticsearchDriver: IntegrationDriver = {
  async testConnection(cfg: DriverConfig): Promise<TestResult> {
    return isMock(cfg) ? mockTestConnection(cfg) : testConnection(cfg);
  },
};

export {
  esFetch,
  searchLogs,
  getLogStats,
  getLogMetric,
  testConnection,
  parseTimeExpr,
  chooseInterval,
} from "./client";
export { mockSearchLogs, mockLogStats, mockLogMetric, mockTestConnection } from "./mock";
