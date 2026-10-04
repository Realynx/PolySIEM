import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The bundler constraint, enforced instead of commented.
 *
 * A module that reaches a client bundle may not import a Node builtin. Not "should
 * not" — Turbopack cannot bundle it at all, and the page dies at load with:
 *
 *     ./src/lib/ssh/target.ts
 *     Code generation for chunk item errored
 *       the chunking context (unknown) does not support external modules (request: node:net)
 *
 * This is not theoretical. `src/lib/ssh/target.ts` imported `isIP` from `node:net`
 * for exactly one refinement while deliberately NOT being `server-only`, because
 * client components import the same zod schemas the API routes parse with. The
 * hazard was known — `src/components/network/edge-networks-types.ts` carried a
 * comment warning about "that node:net-based module" — but a comment protects
 * nothing, and months later a privacy-router component imported
 * `src/lib/validators/privacy-router.ts`, which reaches `validators/integrations.ts`,
 * which reaches `ssh/target.ts`, and the app stopped rendering.
 *
 * So the invariant is checked by walking the real import graph. `src/lib/net/ip.ts`
 * is the pure, browser-safe `isIP` those validators use now.
 *
 * IF THIS TEST FAILS, the fix is one of:
 *   - import the pure equivalent instead (`@/lib/net/ip` for `node:net`), or
 *   - move the server-side work behind an API route and keep the client module to
 *     types and pure helpers, or
 *   - make the import type-only (`import type { … }`), which is erased and never
 *     reaches the bundle.
 * Deleting the offending entry point from the lists below, or deleting this test,
 * just moves the failure to the browser where nobody can see the cause.
 */

const SRC_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * Modules this codebase PROMISES are browser-safe, whether or not a client
 * component currently imports one.
 *
 * These are checked as roots in their own right so the guard does not silently
 * lapse the moment the last client component stops importing a validator: the
 * promise is what the next author will rely on, so the promise is what is tested.
 */
const BROWSER_SAFE_MODULES = [
  "lib/net",
  "lib/validators",
  "lib/ssh/target.ts",
  "lib/managed-host-url.ts",
];

/** Bare builtin ids (`"crypto"`) as well as prefixed ones (`"node:crypto"`). */
const BUILTIN_IDS = new Set(builtinModules);

function isTsSource(file: string): boolean {
  return /\.tsx?$/.test(file) && !/\.d\.ts$/.test(file);
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(full, out);
    else if (isTsSource(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Drop comments before looking for imports.
 *
 * Not cosmetic: `src/lib/ssh/target.ts` contains the JSDoc reference
 * `{@link import("./keys").KNOWN_KEY_TYPES}`, which reads as a dynamic import and
 * would otherwise add an edge that does not exist at runtime.
 */
function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, " ");
  return withoutBlocks
    .split("\n")
    .map((line) => {
      const index = line.indexOf("//");
      if (index < 0) return line;
      // Only a `//` outside string literals starts a comment, so that a URL in a
      // string ("https://…") is not mistaken for one.
      const quotes = (line.slice(0, index).match(/["'`]/g) ?? []).length;
      return quotes % 2 === 0 ? line.slice(0, index) : line;
    })
    .join("\n");
}

/**
 * True when every named specifier is `type`-prefixed, so TypeScript erases the
 * whole statement and it never reaches the bundle. `import { type A, b }` keeps
 * `b`, so it is a real edge; `import { type A, type B }` is not.
 */
function isErasedClause(clause: string): boolean {
  const trimmed = clause.trim();
  if (trimmed.startsWith("type ") || trimmed === "type") return true;
  const braces = /^\{([\s\S]*)\}$/.exec(trimmed);
  if (!braces) return false;
  const specifiers = braces[1].split(",").map((part) => part.trim()).filter(Boolean);
  return specifiers.length > 0 && specifiers.every((part) => /^type\s/.test(part));
}

// A `from "…"` clause. The clause body excludes `;`, quotes and backticks so it
// can never run past the end of one statement into a later import.
const FROM_CLAUSE = /(?:^|[\n;])[ \t]*(?:import|export)[\s]+((?:[^;"'`])*?)from[ \t]*["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT = /(?:^|[\n;])[ \t]*import[ \t]*["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport[ \t]*\([ \t]*["']([^"']+)["']/g;

/** Every module specifier this file imports at RUNTIME, type-only ones excluded. */
function importedSpecifiers(source: string): string[] {
  const code = stripComments(source);
  const specifiers: string[] = [];
  for (const match of code.matchAll(FROM_CLAUSE)) {
    if (!isErasedClause(match[1])) specifiers.push(match[2]);
  }
  for (const match of code.matchAll(SIDE_EFFECT_IMPORT)) specifiers.push(match[1]);
  for (const match of code.matchAll(DYNAMIC_IMPORT)) specifiers.push(match[1]);
  return specifiers;
}

const SOURCE_FILES = new Set(listSourceFiles(SRC_ROOT).map((file) => path.normalize(file)));

/** Resolve a specifier to a file inside `src/`, or null when it leaves the tree. */
function resolveToSource(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(SRC_ROOT, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(fromFile), specifier)
      : null;
  if (base === null) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    const normalized = path.normalize(candidate);
    if (SOURCE_FILES.has(normalized)) return normalized;
  }
  return null;
}

/** The builtin a specifier names, or null for a relative path or an npm package. */
function builtinImport(specifier: string): string | null {
  if (specifier.startsWith("node:")) return specifier;
  if (specifier.startsWith(".") || specifier.startsWith("@/")) return null;
  return BUILTIN_IDS.has(specifier) || BUILTIN_IDS.has(specifier.split("/")[0]) ? specifier : null;
}

function relative(file: string): string {
  return path.relative(SRC_ROOT, file).split(path.sep).join("/");
}

/** True when the file opens with a `"use client"` directive. */
function isClientEntryPoint(file: string): boolean {
  const head = stripComments(readFileSync(file, "utf8")).trimStart();
  return head.startsWith('"use client"') || head.startsWith("'use client'");
}

interface Violation {
  builtin: string;
  /** Entry point → … → offending module, as `src/`-relative paths. */
  chain: string[];
}

/**
 * Walk out from `roots` and report every Node builtin found along the way, with
 * the import chain that reaches it — the chain is the point, because the file
 * Turbopack names is rarely the file whose author made the choice.
 */
function builtinsReachableFrom(roots: readonly string[]): Violation[] {
  const parents = new Map<string, string | null>();
  const queue: string[] = [];
  const violations: Violation[] = [];
  for (const root of roots) {
    if (parents.has(root)) continue;
    parents.set(root, null);
    queue.push(root);
  }
  const chainTo = (file: string): string[] => {
    const chain: string[] = [];
    for (let step: string | null | undefined = file; step; step = parents.get(step)) chain.unshift(relative(step));
    return chain;
  };
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const specifier of importedSpecifiers(readFileSync(file, "utf8"))) {
      const builtin = builtinImport(specifier);
      if (builtin !== null) {
        violations.push({ builtin, chain: chainTo(file) });
        continue;
      }
      const target = resolveToSource(specifier, file);
      if (target === null || parents.has(target)) continue;
      parents.set(target, file);
      queue.push(target);
    }
  }
  return violations;
}

function explain(violations: readonly Violation[]): string[] {
  return violations.map((violation) => `${violation.builtin} via ${violation.chain.join(" → ")}`);
}

describe("client bundle safety", () => {
  const clientEntryPoints = [...SOURCE_FILES].filter(isClientEntryPoint).sort();

  it("finds the client components it is supposed to be guarding", () => {
    // A resolution or directive-detection bug would empty this list and turn the
    // whole suite green while checking nothing.
    expect(clientEntryPoints.length).toBeGreaterThan(50);
  });

  it("keeps every module a client component can reach free of Node builtins", () => {
    // Anything reachable from a "use client" file is compiled for the browser.
    // A `node:` import here is not a lint opinion — the chunk fails to generate
    // and the page does not render. Import the pure equivalent (`@/lib/net/ip`
    // replaces `node:net`), move the work behind an API route, or make the
    // import type-only so it is erased.
    expect(explain(builtinsReachableFrom(clientEntryPoints))).toEqual([]);
  });

  it("keeps the modules promised to be browser-safe free of Node builtins", () => {
    const roots = [...SOURCE_FILES]
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .filter((file) => BROWSER_SAFE_MODULES.some((safe) => {
        const full = path.normalize(path.join(SRC_ROOT, safe));
        return file === full || file.startsWith(`${full}${path.sep}`);
      }))
      .sort();
    // These modules are deliberately NOT `server-only` — validators are shared
    // between the API routes that parse with them and the forms that submit to
    // those routes. That sharing is the whole reason they exist, and it is only
    // sound while they stay importable from a browser.
    expect(roots.length).toBeGreaterThan(10);
    expect(explain(builtinsReachableFrom(roots))).toEqual([]);
  });
});
