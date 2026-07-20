#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
PRISMA_BIN="${SCRIPT_DIR}/prisma-cli/node_modules/.bin/prisma"
cd "$SCRIPT_DIR"

"$PRISMA_BIN" migrate deploy --schema prisma/schema.prisma
# tls-server.js serves HTTPS (self-signed by default, POLYSIEM_TLS=off opts
# out); fall back to the plain server for bundles that predate it.
if [ -f "${SCRIPT_DIR}/tls-server.js" ]; then
    exec node tls-server.js
fi
exec node server.js
