import { assertBootstrapUsername, bootstrapAuthorizedKey, buildSshBootstrapCommand } from "@/lib/ssh/bootstrap";

/**
 * Edge NAT's view of the shared bootstrap authorization (`src/lib/ssh/bootstrap.ts`).
 *
 * The mechanism itself is not edge-specific — every PolySIEM-managed box is
 * provisioned by pushing an installer through a temporary forced-command
 * authorization — so it moved to the shared SSH module, alongside the transport
 * that uses it. What is left here is the one genuinely edge-specific fact: which
 * restricted service account the operator must NOT bootstrap through.
 *
 * The names below are aliases of the shared definitions, not copies, and are
 * re-exported unchanged because the setup walkthroughs import them by name.
 * Same pattern as `./ssh.ts`.
 */

/** The restricted account the edge installer creates and locks down. */
const EDGE_SERVICE_ACCOUNT = "polysiem-edge";

export function assertEdgeBootstrapUsername(username: string): string {
  return assertBootstrapUsername(username, EDGE_SERVICE_ACCOUNT);
}

export {
  bootstrapAuthorizedKey as edgeBootstrapAuthorizedKey,
  buildSshBootstrapCommand as buildEdgeBootstrapCommand,
};
