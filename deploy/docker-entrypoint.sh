#!/bin/sh
# PolySIEM container entrypoint.
# Waits for PostgreSQL by retrying `prisma migrate deploy`, then starts the
# Next.js standalone server.
set -e

MAX_ATTEMPTS="${MIGRATE_MAX_ATTEMPTS:-30}"
RETRY_DELAY="${MIGRATE_RETRY_DELAY:-2}"
PRISMA_BIN="${PRISMA_BIN:-/opt/prisma-cli/node_modules/.bin/prisma}"

echo "[polysiem] starting up (migrations: up to ${MAX_ATTEMPTS} attempts, ${RETRY_DELAY}s apart)"

attempt=1
while :; do
    echo "[polysiem] applying database migrations (attempt ${attempt}/${MAX_ATTEMPTS})..."
    if "$PRISMA_BIN" migrate deploy --schema prisma/schema.prisma; then
        echo "[polysiem] migrations applied successfully"
        break
    fi
    if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
        echo "[polysiem] ERROR: database is still unreachable after ${MAX_ATTEMPTS} attempts, giving up" >&2
        echo "[polysiem] check DATABASE_URL and that the db container is healthy" >&2
        exit 1
    fi
    echo "[polysiem] database not ready yet, retrying in ${RETRY_DELAY}s..."
    attempt=$((attempt + 1))
    sleep "$RETRY_DELAY"
done

echo "[polysiem] starting server on port ${PORT:-3000}"
exec node server.js
