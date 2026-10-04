/**
 * The TEMPORARY authorization that gets a PolySIEM agent onto a managed host.
 *
 * PolySIEM installs its own restricted key by pushing an installer through an
 * authorization the operator adds BY HAND, signed in as their own administrator
 * account. That line is a forced command — it can run the installer and nothing
 * else — and the installer removes it again before it succeeds. This is the
 * "push-over-bootstrap" half of the two custody modes in `./managed-host.ts`;
 * the other half is the operational key, which never leaves PolySIEM.
 *
 * Pure on purpose, and deliberately NOT `server-only`: the one-liner is rendered
 * into the setup walkthroughs, which are client components, and the exact bytes
 * an operator pastes must be the exact bytes the installer expects. One
 * definition is the only way that stays true.
 *
 * This lives in `src/lib/ssh/` rather than inside one integration because every
 * PolySIEM-managed box bootstraps the same way — edge NAT servers today, VPN
 * routers now, whatever comes next. A feature that needed it used to import it
 * from `integrations/edge-nat/`, which is exactly the dependency direction the
 * shared-SSH work exists to end.
 */

const ADMIN_USERNAME = /^[a-z_][a-z0-9_-]{0,31}$/i;

/**
 * The operator's OWN administrator account, validated.
 *
 * `serviceAccount` is the restricted account PolySIEM will create on that host.
 * Naming it here would authorize the temporary key on the very account the
 * installer is about to lock down, so it is refused with an explanation rather
 * than a generic validation error.
 */
export function assertBootstrapUsername(username: string, serviceAccount: string): string {
  const value = username.trim();
  if (!ADMIN_USERNAME.test(value)) {
    throw new Error("Use a Linux administrator username (letters, numbers, underscores, and hyphens only)");
  }
  if (value === serviceAccount) {
    throw new Error(`Use your existing administrator account, not the restricted ${serviceAccount} service account`);
  }
  return value;
}

/**
 * Temporary authorization used only during provisioning. OpenSSH ignores the
 * command requested by the client and runs this forced installer command.
 */
export function bootstrapAuthorizedKey(publicKey: string): string {
  if (!/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}(?: .*)?$/.test(publicKey)) {
    throw new Error("Invalid SSH public key");
  }
  return `restrict,command="if test $(id -u) -eq 0; then exec sh -s; else exec sudo -n sh -s; fi" ${publicKey}`;
}

function singleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** A short command the operator runs while signed in as the chosen admin. */
export function buildSshBootstrapCommand(publicKey: string): string {
  const line = bootstrapAuthorizedKey(publicKey);
  const quoted = singleQuote(line);
  return `umask 077;d=$HOME/.ssh;mkdir -p "$d";chmod 700 "$d";printf '%s\\n' ${quoted} >>"$d/authorized_keys";chmod 600 "$d/authorized_keys"`;
}
