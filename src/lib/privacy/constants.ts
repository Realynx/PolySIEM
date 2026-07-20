/**
 * Shared privacy-shield identifiers. Isomorphic — imported by both the
 * client shield hook/provider and the server-side anonymization gate, so
 * keep this module free of any browser or server-only dependencies.
 */

/** Class set on <html> while the visual shield (blur) is engaged. */
export const PRIVACY_SHIELD_CLASS = "privacy-shield";

/**
 * Cookie mirroring the client shield state so server components render
 * anonymized data on the refresh that follows a shield engagement.
 */
export const PRIVACY_SHIELD_COOKIE = "polysiem-privacy-shield";
