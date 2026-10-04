import { z } from "zod";

/**
 * Build the PATCH (partial-update) schema for a create schema.
 *
 * WHY THIS EXISTS — the zod v4 `.partial()` trap
 * ----------------------------------------------
 * `.partial()` makes every key optional but it does NOT remove `.default()`.
 * A defaulted key is therefore still PRODUCED when the client omits it:
 *
 *   const base = z.object({ name: z.string(), enabled: z.boolean().default(true) });
 *   base.partial().parse({})   // => { enabled: true }   <- key is PRESENT
 *
 * Every `createXSchema.partial()` PATCH schema built that way silently injects
 * values the client never sent. Services then write them back: one that spreads
 * the patch into a Prisma `update` persists the default over the stored value,
 * and one that merges `patch.x ?? existing.x` never sees `undefined`, so the
 * `??` fallback to the existing value can never fire. A
 * `.refine(v => Object.keys(v).length > 0)` "send at least one field" guard on
 * such a schema can never fail either, because the injected defaults always
 * populate keys.
 *
 * This trap was rediscovered three separate times in this repo (see the warning
 * comments in `validators/scan.ts`, `validators/tunnels.ts` and
 * `validators/privacy-router.ts`) and was worked around three separate times by
 * route-level "drop the keys the client did not send" wrappers. This helper is
 * the single fix: it strips the defaults from the SCHEMA, so every caller —
 * routes, MCP tools, tests — gets absent-means-absent without knowing the trap.
 *
 * The shape is mapped generically and `ZodDefault` is unwrapped before keys are
 * made optional, so it keeps working as schemas evolve; there is deliberately no
 * hand-maintained list of defaulted keys to fall out of date.
 *
 * Create/POST behaviour is untouched: defaults live on the create schema and
 * still apply there. Only the derived PATCH schema drops them.
 *
 * Nested defaults are intentionally preserved. A nested object is only reached
 * when the client actually sends that key, so its defaults are create-like
 * semantics for the value being supplied, not an injection into an absent key.
 */
export function patchSchema<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [key, stripDefault(field)]),
  ) as unknown as PatchShape<Shape>;
  return z.object(shape).partial();
}

/** `z.ZodDefault<T>` collapses to `T`; anything else is passed through. */
type PatchShape<Shape extends z.ZodRawShape> = {
  [K in keyof Shape]: Shape[K] extends z.ZodDefault<infer Inner> ? Inner : Shape[K];
};

/**
 * `.default()` and `.prefault()` both wrap the real schema and both synthesise a
 * value for an absent key, which is exactly what a PATCH must not do.
 */
function stripDefault(field: z.core.$ZodType): z.core.$ZodType {
  const type = field._zod.def.type;
  if (type === "default" || type === "prefault") {
    return (field as unknown as z.ZodDefault<z.ZodType>).unwrap();
  }
  return field;
}
