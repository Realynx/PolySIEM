import type { TicketEvidenceSample } from "@/lib/types";

export interface EvidenceField {
  label: string;
  value: string;
  mono?: boolean;
}

export interface EvidenceSection {
  title: string;
  fields: EvidenceField[];
}

export interface EvidencePresentation {
  kind: "Suricata alert" | "HTTP event" | "Security event";
  title: string;
  badges: string[];
  route: string | null;
  sections: EvidenceSection[];
  decodedRaw: Record<string, unknown> | null;
  truncated: boolean;
}

type Document = Record<string, unknown>;

const SIGNATURE_FIELDS = [
  "suricata.eve.alert.signature",
  "alert.signature",
  "rule.name",
  "rule.description",
];

function object(value: unknown): value is Document {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value: string): unknown | undefined {
  const text = value.trim();
  if (!(text.startsWith("{") || text.startsWith("["))) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Recover all complete top-level fields from a JSON object cut off mid-value. */
export function recoverTruncatedObject(value: string): Document | null {
  const text = value.trim().replace(/…$/, "");
  if (!text.startsWith("{")) return null;

  const topLevelCommas = findTopLevelCommas(text);
  for (let i = topLevelCommas.length - 1; i >= 0; i--) {
    try {
      const recovered = JSON.parse(`${text.slice(0, topLevelCommas[i])}}`);
      if (object(recovered)) return recovered;
    } catch {
      // Try the previous complete top-level property.
    }
  }
  return null;
}

function findTopLevelCommas(text: string): number[] {
  let depth = 0;
  let inString = false;
  let escaped = false;
  const topLevelCommas: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") depth--;
    else if (char === "," && depth === 1) topLevelCommas.push(i);
  }

  return topLevelCommas;
}

function decodeJsonStrings(value: unknown, depth = 0): unknown {
  if (depth >= 5) return value;
  if (typeof value === "string") {
    const parsed = parseJson(value);
    return parsed === undefined ? value : decodeJsonStrings(parsed, depth + 1);
  }
  if (Array.isArray(value)) {
    return value.map((item) => decodeJsonStrings(item, depth + 1));
  }
  if (object(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        decodeJsonStrings(item, depth + 1),
      ]),
    );
  }
  return value;
}

export function decodeEvidenceRaw(raw: Document | undefined): {
  value: Document | null;
  truncated: boolean;
} {
  if (!raw) return { value: null, truncated: false };
  const truncatedValue = raw._truncated;
  if (typeof truncatedValue === "string") {
    const recovered = recoverTruncatedObject(truncatedValue);
    return {
      value: recovered ? (decodeJsonStrings(recovered) as Document) : raw,
      truncated: true,
    };
  }
  return { value: decodeJsonStrings(raw) as Document, truncated: false };
}

function getField(document: Document, path: string): unknown {
  if (path in document) return document[path];
  let current: unknown = document;
  for (const part of path.split(".")) {
    if (!object(current)) return undefined;
    current = current[part];
  }
  return current;
}

function candidateDocuments(raw: Document | null): Document[] {
  if (!raw) return [];
  const documents = [raw];
  for (const path of ["event.original", "log.original", "message", "json"]) {
    const value = getField(raw, path);
    if (object(value)) documents.push(value);
  }
  return documents;
}

function scalar(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const values = value.map(scalar).filter((item): item is string => Boolean(item));
    return values.length ? values.join(", ") : null;
  }
  return null;
}

function first(documents: Document[], paths: string[]): string | null {
  for (const document of documents) {
    for (const path of paths) {
      const value = scalar(getField(document, path));
      if (value) return value;
    }
  }
  return null;
}

function field(label: string, value: string | null, mono = false): EvidenceField | null {
  return value ? { label, value, mono } : null;
}

function fields(...values: (EvidenceField | null)[]): EvidenceField[] {
  return values.filter((value): value is EvidenceField => Boolean(value));
}

function endpoint(ip: string | null, port: string | null): string | null {
  if (!ip) return null;
  const bracketed = ip.includes(":") && port ? `[${ip}]` : ip;
  return port ? `${bracketed}:${port}` : bracketed;
}

function severityLabel(value: string | null): string | null {
  if (!value) return null;
  return { "1": "High (1)", "2": "Medium (2)", "3": "Low (3)" }[value] ?? value;
}

function humanize(path: string): string {
  return path
    .split(".")
    .map((part) =>
      part.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
    )
    .join(" › ");
}

function fallbackFields(document: Document | null, limit = 18): EvidenceField[] {
  if (!document) return [];
  const output: EvidenceField[] = [];
  const skip = /(^|\.)(message|original|payload|payload_printable|packet|_truncated)$/i;
  const visit = (value: unknown, path: string, depth: number) => {
    if (output.length >= limit || depth > 4 || skip.test(path)) return;
    const text = scalar(value);
    if (text && text.length <= 300) {
      output.push({
        label: humanize(path),
        value: text,
        mono: /(^|\.)(ip|address|port|id|uuid|hash|hostname|domain)$/i.test(path),
      });
      return;
    }
    if (object(value)) {
      for (const [key, child] of Object.entries(value)) {
        visit(child, path ? `${path}.${key}` : key, depth + 1);
      }
    }
  };
  for (const [key, value] of Object.entries(document)) visit(value, key, 0);
  return output;
}

function isSuricataEvidence(
  documents: Document[],
  signature: string | null,
  eventModule: string | null,
  scope?: string,
): boolean {
  return scope?.toLowerCase() === "suricata"
    || Boolean(signature)
    || Boolean(eventModule?.toLowerCase().includes("suricata"))
    || documents.some((document) => object(getField(document, "suricata.eve")));
}

function addSection(sections: EvidenceSection[], title: string, sectionFields: EvidenceField[]) {
  if (sectionFields.length > 0) sections.push({ title, fields: sectionFields });
}

function addFallbackSection(sections: EvidenceSection[], document: Document | null) {
  if (sections.length > 0) return;
  addSection(sections, "Event fields", fallbackFields(document));
}

function evidenceKind(isSuricata: boolean, method: string | null, status: string | null): EvidencePresentation["kind"] {
  if (isSuricata) return "Suricata alert";
  if (method || status) return "HTTP event";
  return "Security event";
}

export function formatEvidenceSample(
  sample: TicketEvidenceSample,
  scope?: string,
): EvidencePresentation {
  const decoded = decodeEvidenceRaw(sample.raw);
  const documents = candidateDocuments(decoded.value);
  const signature = first(documents, SIGNATURE_FIELDS);
  const eventModule = first(documents, ["event.module", "event.dataset", "service.type"]);
  const isSuricata = isSuricataEvidence(documents, signature, eventModule, scope);

  const sourceIp = first(documents, ["source.ip", "source.address", "suricata.eve.src_ip", "src_ip"]);
  const sourcePort = first(documents, ["source.port", "suricata.eve.src_port", "src_port"]);
  const destinationIp = first(documents, [
    "destination.ip",
    "destination.address",
    "suricata.eve.dest_ip",
    "dest_ip",
  ]);
  const destinationPort = first(documents, [
    "destination.port",
    "suricata.eve.dest_port",
    "dest_port",
  ]);
  const protocol = first(documents, ["network.transport", "network.protocol", "suricata.eve.proto", "proto"]);
  const method = first(documents, ["http.request.method", "suricata.eve.http.http_method"]);
  const status = first(documents, ["http.response.status_code", "suricata.eve.http.status"]);
  const hostname = first(documents, [
    "url.domain",
    "http.request.referrer",
    "suricata.eve.http.hostname",
    "tls.server.name",
    "suricata.eve.tls.sni",
  ]);
  const url = first(documents, ["url.full", "url.original", "suricata.eve.http.url"]);
  const severity = severityLabel(
    first(documents, ["suricata.eve.alert.severity", "alert.severity", "event.severity"]),
  );
  const category = first(documents, ["suricata.eve.alert.category", "alert.category", "rule.category"]);
  const eventType = first(documents, ["suricata.eve.event_type", "event.type", "event.category"]);
  const action = first(documents, ["suricata.eve.alert.action", "event.action"]);
  const route =
    sourceIp || destinationIp
      ? `${endpoint(sourceIp, sourcePort) ?? "?"} → ${endpoint(destinationIp, destinationPort) ?? "?"}`
      : null;

  const sections: EvidenceSection[] = [];
  const alertFields = fields(
    field("Signature", signature),
    field("Category", category),
    field("Severity", severity),
    field("Action", action),
    field("Event type", eventType),
  );
  addSection(sections, isSuricata ? "Alert" : "Event", alertFields);

  const networkFields = fields(
    field("Source", endpoint(sourceIp, sourcePort), true),
    field("Destination", endpoint(destinationIp, destinationPort), true),
    field("Protocol", protocol?.toUpperCase() ?? null, true),
    field("Direction", first(documents, ["network.direction", "suricata.eve.flow.state"])),
    field("Flow ID", first(documents, ["suricata.eve.flow_id", "flow.id"]), true),
    field("Interface", first(documents, ["suricata.eve.in_iface", "network.interface.name"]), true),
  );
  addSection(sections, "Connection", networkFields);

  const webFields = fields(
    field("Method", method, true),
    field("Status", status, true),
    field("Host", hostname, true),
    field("URL", url, true),
    field("User agent", first(documents, ["user_agent.original", "suricata.eve.http.http_user_agent"])),
    field("TLS subject", first(documents, ["tls.server.subject", "suricata.eve.tls.subject"])),
    field("TLS issuer", first(documents, ["tls.server.issuer", "suricata.eve.tls.issuerdn"])),
    field("DNS query", first(documents, ["dns.question.name", "suricata.eve.dns.rrname"]), true),
  );
  addSection(sections, "Application", webFields);

  const contextFields = fields(
    field("Sensor", first(documents, ["host.name", "observer.name", "agent.name"])),
    field("Dataset", first(documents, ["event.dataset", "event.module"]), true),
    field("Community ID", first(documents, ["network.community_id"]), true),
  );
  addSection(sections, "Context", contextFields);
  addFallbackSection(sections, decoded.value);

  const badges = [severity, category, eventType, protocol?.toUpperCase()]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 4);

  return {
    kind: evidenceKind(isSuricata, method, status),
    title: signature ?? sample.message,
    badges,
    route,
    sections,
    decodedRaw: decoded.value,
    truncated: decoded.truncated,
  };
}
