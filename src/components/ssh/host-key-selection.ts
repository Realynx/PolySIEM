/**
 * Which scanned SSH host key a "trust this host" control would pin, before the
 * operator has picked one.
 *
 * Every PolySIEM surface that enrolls a managed box over SSH — edge servers,
 * connectors, privacy routers, on desktop and on a phone — asks this same
 * question, and until now every one of them answered it with its own local
 * copy. The copies had already drifted: some consulted the record's stored
 * fingerprint before the scan's, some only the scan's, one returned `undefined`
 * where the others returned `""`. That matters because the answer decides which
 * key a single click pins, and pinning is the whole security boundary.
 *
 * The rule, stated once:
 *
 *  1. An explicit pick always wins. The operator compared a fingerprint out of
 *     band; nothing PolySIEM knows overrides that.
 *  2. Otherwise the already-enrolled key, so re-opening a scan on an enrolled
 *     host does not silently offer to re-pin a different one.
 *  3. Otherwise a LONE observed key — with one candidate there is nothing to
 *     choose between.
 *  4. Otherwise nothing. Several unknown keys and no prior trust is exactly the
 *     case where a default would be a guess, and the operator must choose.
 *
 * Pure and React-free so it unit-tests under vitest's node environment.
 */

/**
 * One key a host presented during a scan, narrowed to the only field the choice
 * turns on. Callers carry richer shapes — an algorithm, a comment — and each
 * spells the optionality of those differently; requiring them here would make
 * this rule refuse a scan it is perfectly able to answer for.
 */
export interface ObservedHostKey {
  fingerprint: string;
}

/**
 * The fingerprint to preselect.
 *
 * `enrolled` takes the record's stored fingerprint where the caller has one and
 * the scan's `enrolledFingerprint` otherwise — they are the same claim from two
 * sources, and a caller that can see both should prefer the one it trusts.
 *
 * Returns `""` — never `undefined` — so a caller can hand it straight to a
 * `disabled={!selected}` check.
 */
export function preferredHostKeyFingerprint(
  chosen: string,
  enrolled: string | null | undefined,
  keys: readonly ObservedHostKey[],
): string {
  if (chosen) return chosen;
  if (enrolled) return enrolled;
  return keys.length === 1 ? keys[0]?.fingerprint ?? "" : "";
}
