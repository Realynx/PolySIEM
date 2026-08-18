/**
 * WireGuard key crypto — public API.
 *
 * Server-side only (depends on `node:crypto`). Keep it out of client-imported
 * files so it never lands in the browser bundle.
 */
export {
  WIREGUARD_KEY_REGEX,
  generateWireguardKeypair,
  isValidWireguardKey,
  wireguardPublicFromPrivate,
} from "./keys";
