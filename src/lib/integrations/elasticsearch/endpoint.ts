export const KIBANA_ENDPOINT_MESSAGE =
  "This is a Kibana address (usually port 5601). Enter the Elasticsearch HTTP endpoint instead, usually the same host on port 9200.";

/** Detect the most common case where the Kibana UI is entered as the Elasticsearch API. */
export function getElasticsearchEndpointIssue(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.trim());
    if (url.port === "5601" || /^\/(?:app|login)(?:\/|$)/i.test(url.pathname)) {
      return KIBANA_ENDPOINT_MESSAGE;
    }
  } catch {
    // The integration validator owns general URL validation.
  }
  return null;
}

