const ADMIN_USERNAME = /^[a-z_][a-z0-9_-]{0,31}$/i;

export function assertEdgeBootstrapUsername(username: string): string {
  const value = username.trim();
  if (!ADMIN_USERNAME.test(value)) {
    throw new Error("Use a Linux administrator username (letters, numbers, underscores, and hyphens only)");
  }
  if (value === "polysiem-edge") {
    throw new Error("Use your existing administrator account, not the restricted polysiem-edge service account");
  }
  return value;
}

/**
 * Temporary authorization used only during provisioning. OpenSSH ignores the
 * command requested by the client and runs this forced installer command.
 */
export function edgeBootstrapAuthorizedKey(publicKey: string): string {
  if (!/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}(?: .*)?$/.test(publicKey)) {
    throw new Error("Invalid Edge NAT public key");
  }
  return `restrict,command="if test $(id -u) -eq 0; then exec sh -s; else exec sudo -n sh -s; fi" ${publicKey}`;
}

function singleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** A short command the operator runs while signed in as the chosen admin. */
export function buildEdgeBootstrapCommand(publicKey: string): string {
  const line = edgeBootstrapAuthorizedKey(publicKey);
  const quoted = singleQuote(line);
  return `umask 077;d=$HOME/.ssh;mkdir -p "$d";chmod 700 "$d";printf '%s\\n' ${quoted} >>"$d/authorized_keys";chmod 600 "$d/authorized_keys"`;
}
