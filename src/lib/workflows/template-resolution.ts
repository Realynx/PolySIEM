/** A parsed workflow template reference such as `{{input.name}}`. */
export interface TemplateRef {
  source: "input" | "nodes";
  nodeId: string | null;
  key: string;
  raw: string;
}

const TEMPLATE_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

function parseRef(inner: string, raw: string): TemplateRef | null {
  if (inner.startsWith("input.")) {
    const key = inner.slice("input.".length);
    return key ? { source: "input", nodeId: null, key, raw } : null;
  }

  if (inner.startsWith("nodes.")) {
    const rest = inner.slice("nodes.".length);
    const lastDot = rest.lastIndexOf(".");
    if (lastDot <= 0 || lastDot === rest.length - 1) return null;
    return {
      source: "nodes",
      nodeId: rest.slice(0, lastDot),
      key: rest.slice(lastDot + 1),
      raw,
    };
  }

  return null;
}

export function collectTemplateRefs(value: string): TemplateRef[] {
  const refs: TemplateRef[] = [];
  for (const match of value.matchAll(TEMPLATE_RE)) {
    const ref = parseRef(match[1], match[0]);
    if (ref) refs.push(ref);
  }
  return refs;
}

export class TemplateError extends Error {
  constructor(public ref: string, message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

export interface TemplateScope {
  input: Record<string, unknown>;
  nodeOutputs: Record<string, Record<string, unknown>>;
}

function lookupRef(ref: TemplateRef, scope: TemplateScope): unknown {
  if (ref.source === "input") {
    if (!(ref.key in scope.input)) {
      throw new TemplateError(ref.raw, `Unknown trigger input "${ref.key}" in ${ref.raw}`);
    }
    return scope.input[ref.key];
  }

  const outputs = scope.nodeOutputs[ref.nodeId ?? ""];
  if (!outputs) {
    throw new TemplateError(
      ref.raw,
      `Node "${ref.nodeId}" has no outputs (not upstream or skipped) in ${ref.raw}`,
    );
  }
  if (!(ref.key in outputs)) {
    throw new TemplateError(
      ref.raw,
      `Node "${ref.nodeId}" has no output "${ref.key}" in ${ref.raw}`,
    );
  }
  return outputs[ref.key];
}

export function stringifyTemplateValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function resolveTemplateString(value: string, scope: TemplateScope): unknown {
  const single = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(value.trim());
  if (single) {
    const ref = parseRef(single[1], single[0]);
    if (ref) return lookupRef(ref, scope);
  }

  return value.replace(TEMPLATE_RE, (raw, inner: string) => {
    const ref = parseRef(inner, raw);
    return ref ? stringifyTemplateValue(lookupRef(ref, scope)) : raw;
  });
}

export function resolveConfig<T>(config: T, scope: TemplateScope): T {
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return resolveTemplateString(value, scope);
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, walk(child)]),
      );
    }
    return value;
  };

  return walk(config) as T;
}
