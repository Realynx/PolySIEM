/**
 * Deep-convert values so they survive `NextResponse.json`: BigInt to string,
 * Date to ISO, `Map` to an object, `Set` to an array.
 *
 * `Map` and `Set` are handled EXPLICITLY, before the generic object branch.
 * Neither has own enumerable properties, so `Object.entries` sees nothing and a
 * populated collection would serialize to `{}` — silently, with no error, in a
 * response nobody would think to check. That is strictly worse than either
 * carrying the data or throwing, and it shipped once already
 * (`PrivacyRouterStatus.probes` reached the UI as an empty object however the
 * per-exit probes went). Handling them here is what makes it unrepeatable.
 *
 * A `Map` becomes an object keyed by `String(key)`, because that is the only key
 * type JSON has. `Object.fromEntries` DEFINES each key as a data property rather
 * than assigning it, so a key of `__proto__` lands as an ordinary own property
 * instead of reaching a prototype setter.
 */
export function toJsonSafe<T>(value: T): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].map(([k, v]) => [String(k), toJsonSafe(v)]));
  }
  if (value instanceof Set) return [...value.values()].map(toJsonSafe);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}
