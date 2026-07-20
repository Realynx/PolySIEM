/**
 * Check registry: run every pure check module over a snapshot. A check that
 * throws must never take the advisor down — it is skipped (matching the
 * "skip, don't fail" pattern the syncs use) and the rest still report.
 */

import type { SecurityFinding, SecuritySnapshot } from "../types";
import { sortFindings } from "../score";
import { checkAccess } from "./access";
import { checkDocumentation } from "./documentation";
import { checkExposure } from "./exposure";
import { checkFirewall } from "./firewall";
import { checkHardening } from "./hardening";

const CHECKS: ((snap: SecuritySnapshot) => SecurityFinding[])[] = [
  checkExposure,
  checkFirewall,
  checkAccess,
  checkHardening,
  checkDocumentation,
];

export function runSecurityChecks(snapshot: SecuritySnapshot): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const check of CHECKS) {
    try {
      findings.push(...check(snapshot));
    } catch (err) {
      console.error(`[security] check ${check.name} failed, skipping:`, err);
    }
  }
  return sortFindings(findings);
}
