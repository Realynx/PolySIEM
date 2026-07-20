import type { CloudflareAccountSnapshot } from "./types";

export interface CloudflareServiceCandidate {
  externalId: string;
  name: string;
  url: string;
  port: 443;
  protocol: "https";
  description: string;
  publicHostname: string;
  originHost: string | null;
  originEndpoint: string | null;
  metadata: {
    evidence: "cloudflare-published-route";
    integrationId: string;
    accountId: string;
    accountName: string;
    tunnelId: string;
    tunnelName: string;
    hostname: string;
    path: string | null;
    originService: string;
    capturedAt: string;
  };
}

function normalizedHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function normalizedPath(value: string | null): string | null {
  const path = value?.trim();
  return path ? path : null;
}

function publicUrl(hostname: string, path: string | null): string {
  const literalPath = path && path.startsWith("/") && !/[\*^$()[\]{}|\\]/.test(path) ? path : "";
  return `https://${hostname}${literalPath}`;
}

/** Canonical HTTP(S) endpoint used to compare public and origin evidence. */
export function serviceEndpoint(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    return `${url.protocol}//${normalizedHostname(url.hostname)}:${port}`;
  } catch {
    return null;
  }
}

function originHost(service: string): string | null {
  try {
    const url = new URL(service.trim());
    return normalizedHostname(url.hostname) || null;
  } catch {
    return null;
  }
}

/** Turn authoritative Cloudflare ingress rows into bounded service evidence. */
export function cloudflareServiceCandidates(snapshot: CloudflareAccountSnapshot): CloudflareServiceCandidate[] {
  const candidates = new Map<string, CloudflareServiceCandidate>();

  for (const tunnel of snapshot.tunnels) {
    for (const ingress of tunnel.ingress) {
      if (!ingress.hostname) continue;
      const hostname = normalizedHostname(ingress.hostname);
      if (!hostname) continue;
      const path = normalizedPath(ingress.path);
      const externalId = `published-route:${tunnel.id}:${hostname}:${path ?? "*"}`;
      const routeLabel = `${hostname}${path ? ` ${path}` : ""}`;
      candidates.set(externalId, {
        externalId,
        name: hostname,
        url: publicUrl(hostname, path),
        port: 443,
        protocol: "https",
        description: `Discovered from Cloudflare: ${routeLabel} is published through tunnel “${tunnel.name}” to ${ingress.service}.`,
        publicHostname: hostname,
        originHost: originHost(ingress.service),
        originEndpoint: serviceEndpoint(ingress.service),
        metadata: {
          evidence: "cloudflare-published-route",
          integrationId: snapshot.integrationId,
          accountId: snapshot.account.id,
          accountName: snapshot.account.name,
          tunnelId: tunnel.id,
          tunnelName: tunnel.name,
          hostname,
          path,
          originService: ingress.service,
          capturedAt: snapshot.capturedAt,
        },
      });
    }
  }

  return [...candidates.values()];
}

