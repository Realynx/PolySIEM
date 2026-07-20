import { isLockedDemoMode } from "@/lib/demo/mode";

const DEFAULT_APP_URL = "http://localhost:3000";

export interface SitePresentation {
  baseUrl: URL;
  title: string;
  description: string;
  cardLabel: string;
  isPublicDemo: boolean;
}

type SiteEnvironment = Record<string, string | undefined>;

function appUrl(value: string | undefined): URL {
  try {
    const parsed = new URL(value?.trim() || DEFAULT_APP_URL);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return new URL(DEFAULT_APP_URL);
    }
    return parsed;
  } catch {
    return new URL(DEFAULT_APP_URL);
  }
}

/** Shared copy and canonical URL for page metadata and generated social cards. */
export function getSitePresentation(
  env: SiteEnvironment = process.env,
): SitePresentation {
  const isPublicDemo = isLockedDemoMode(env);
  const baseUrl = appUrl(env.APP_URL);

  return {
    baseUrl,
    title: isPublicDemo ? "PolySIEM Public Demo" : "PolySIEM",
    description: isPublicDemo
      ? "Explore a live, read-only PolySIEM lab with security monitoring, AI-assisted investigation, and realistic infrastructure data."
      : "Self-hosted homelab documentation, security visibility, AI-assisted investigation, and Suricata threat intelligence.",
    cardLabel: isPublicDemo
      ? "PUBLIC DEMO · READ ONLY"
      : baseUrl.hostname === "localhost"
        ? "SELF-HOSTED HOMELAB PLATFORM"
        : `SELF-HOSTED · ${baseUrl.hostname.toUpperCase()}`,
    isPublicDemo,
  };
}
