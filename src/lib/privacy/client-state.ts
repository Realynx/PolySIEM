/**
 * Module-level privacy state for the browser. The apiFetch envelope reads it
 * synchronously (it is not a hook), and PrivacyProvider keeps it in sync with
 * the user's settings and the live shield state.
 */

let privacyActive = false;
const listeners = new Set<() => void>();

export function isPrivacyActive(): boolean {
  return privacyActive;
}

export function setPrivacyActive(active: boolean): void {
  if (privacyActive === active) return;
  privacyActive = active;
  for (const listener of listeners) listener();
}

export function subscribePrivacy(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Display-data endpoints whose GET responses are safe to anonymize on the
 * client. Config/form endpoints (admin settings, integrations, profile, AI,
 * workflow definitions, backup) are deliberately absent: anonymizing a value
 * that a form later saves back would corrupt real data.
 */
const ANONYMIZE_URL_PREFIXES = [
  "/api/audit",
  "/api/bandwidth",
  "/api/compute",
  "/api/firewall",
  "/api/integrations/status",
  "/api/inventory",
  "/api/keys",
  "/api/logs",
  "/api/network",
  "/api/search",
  "/api/security",
  "/api/tags",
  "/api/tunnels",
  "/api/workflows/runs",
];

/** Endpoints under an allowed prefix that still feed editable forms. */
const ANONYMIZE_URL_EXCLUSIONS = ["/api/logs/scan/config"];

/**
 * Whether a request's response should be anonymized when privacy is active.
 * Only GET responses of known display endpoints are transformed.
 */
export function shouldAnonymizeRequest(url: string, method?: string): boolean {
  if (method && method.toUpperCase() !== "GET") return false;
  let path = url;
  try {
    path = new URL(url, "http://local").pathname;
  } catch {
    // keep raw url; prefixes below only match rooted /api paths anyway
  }
  if (ANONYMIZE_URL_EXCLUSIONS.some((p) => path === p || path.startsWith(`${p}/`))) {
    return false;
  }
  return ANONYMIZE_URL_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}
