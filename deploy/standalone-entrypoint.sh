#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
PRISMA_BIN="${SCRIPT_DIR}/prisma-cli/node_modules/.bin/prisma"
cd "$SCRIPT_DIR"

"$PRISMA_BIN" migrate deploy --schema prisma/schema.prisma
exec node server.js
