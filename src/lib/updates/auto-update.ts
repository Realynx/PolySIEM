import "server-only";

import { timingSafeEqual } from "node:crypto";
import { isLockedDemoMode } from "@/lib/demo/mode";
import { getSetting, SETTING_KEYS } from "@/lib/settings";

export interface AutoUpdateConfig {
  enabled: boolean;
  capable: boolean;
  enforcedByDemo: boolean;
}

type UpdateEnvironment = Record<string, string | undefined>;

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

/** Resolve the effective setting without implying support on unmanaged installs. */
export function resolveAutoUpdateConfig(
  storedEnabled: boolean,
  env: UpdateEnvironment = process.env,
): AutoUpdateConfig {
  const enforcedByDemo = isLockedDemoMode(env);
  const capable = enforcedByDemo || enabled(env.POLYSIEM_AUTO_UPDATE_CAPABLE);
  return {
    enabled: enforcedByDemo || (capable && storedEnabled),
    capable,
    enforcedByDemo,
  };
}

export async function getAutoUpdateConfig(): Promise<AutoUpdateConfig> {
  const storedEnabled = await getSetting<boolean>(SETTING_KEYS.autoUpdate, false);
  return resolveAutoUpdateConfig(storedEnabled);
}

/** Constant-time authentication for the host-side update timer. */
export function isUpdateAgentAuthorized(
  authorization: string | null,
  expectedToken = process.env.POLYSIEM_UPDATE_AGENT_TOKEN,
): boolean {
  if (!expectedToken || !authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  const expected = Buffer.from(expectedToken);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
