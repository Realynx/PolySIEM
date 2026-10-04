#!/usr/bin/env bash
# Assemble the native Linux x64 standalone bundle from a build made on any
# host (including Windows/Git Bash, where Docker/WSL may be unavailable).
#
# The compiled Next.js output is platform-independent; only native modules
# differ. This swaps in the Linux builds of those (Prisma engines, sharp,
# onnxruntime) so the tarball matches what release.yml publishes and can be
# installed with:  bash install-vm.sh --bundle polysiem-<version>-standalone-linux-x64.tar.gz
#
# Usage:  npm run build && bash scripts/build-linux-bundle.sh [version-suffix]
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[ -f .next/standalone/server.js ] || { echo "run 'npm run build' first" >&2; exit 1; }

pkg_version() { node -p "require(process.argv[1]).packages['node_modules/$1'].version" "${ROOT}/package-lock.json"; }
VERSION="$(node -p "require('./package.json').version")${1:+-$1}"
STAGE_ROOT="$(mktemp -d)"
STAGE="${STAGE_ROOT}/polysiem-${VERSION}"
OUT="${ROOT}/dist/polysiem-${VERSION}-standalone-linux-x64.tar.gz"
trap 'rm -rf "$STAGE_ROOT"' EXIT

echo "Assembling ${STAGE##*/}..."
mkdir -p "${STAGE}/.next"
cp -a .next/standalone/. "${STAGE}/"
cp -a .next/static "${STAGE}/.next/static"

# Full generated Prisma client, including both Debian OpenSSL query engines.
rm -rf "${STAGE}/node_modules/.prisma"
cp -a node_modules/.prisma "${STAGE}/node_modules/.prisma"
rm -f "${STAGE}"/node_modules/.prisma/client/*windows* "${STAGE}"/node_modules/.prisma/client/*darwin*
for openssl in 1.1.x 3.0.x; do
  test -f "${STAGE}/node_modules/.prisma/client/libquery_engine-debian-openssl-${openssl}.so.node"
done

# sharp: replace the host's prebuilt binary with the glibc x64 one.
if [ -d "${STAGE}/node_modules/sharp" ]; then
  rm -rf "${STAGE}"/node_modules/@img/sharp-win32-* "${STAGE}"/node_modules/@img/sharp-darwin-* \
    "${STAGE}"/node_modules/@img/sharp-libvips-darwin-*
  PACKS="$(mktemp -d)"
  ( cd "$PACKS" && npm pack --silent \
      "@img/sharp-linux-x64@$(pkg_version sharp)" \
      "@img/sharp-libvips-linux-x64@$(pkg_version @img/sharp-libvips-linux-x64)" >/dev/null )
  for tarball in "$PACKS"/*.tgz; do
    name="$(basename "$tarball" | sed -E 's/^img-(.*)-[0-9]+\.[0-9]+\.[0-9]+\.tgz$/\1/')"
    mkdir -p "${STAGE}/node_modules/@img/${name}"
    tar -xzf "$tarball" -C "${STAGE}/node_modules/@img/${name}" --strip-components=1
  done
  rm -rf "$PACKS"
fi

# onnxruntime: tracing copies only the binding; the Linux build also needs
# its shared library next to it.
ORT="node_modules/onnxruntime-node/bin/napi-v6/linux/x64"
if [ -d "${STAGE}/${ORT}" ] && [ -f "${ORT}/libonnxruntime.so.1" ]; then
  cp "${ORT}/libonnxruntime.so.1" "${STAGE}/${ORT}/"
  # Drop every other platform's runtime (DirectML alone is ~100 MB).
  find "${STAGE}/node_modules/onnxruntime-node/bin/napi-v6" -mindepth 2 -maxdepth 2 -type d ! -path '*/linux/x64' -exec rm -rf {} +
fi

# Locally built privacy-router SNI proxy (static musl ELF), when present.
if [ -d assets/privacy-proxy ]; then
  mkdir -p "${STAGE}/assets"
  cp -a assets/privacy-proxy "${STAGE}/assets/privacy-proxy"
fi

cp -a public prisma "${STAGE}/"
cp server/tls-server.js server/cert-utils.js "${STAGE}/"
cp deploy/standalone-entrypoint.sh "${STAGE}/start.sh"
cp deploy/polysiem.service "${STAGE}/polysiem.service"
cp .env.example README.md LICENSE "${STAGE}/"

# Prisma CLI for `migrate deploy`, with Linux schema engines.
PRISMA_CLI_BINARY_TARGETS="debian-openssl-1.1.x,debian-openssl-3.0.x" \
  npm install --silent --prefix "${STAGE}/prisma-cli" --omit=dev --no-package-lock --no-save \
  --no-audit --no-fund "prisma@$(pkg_version prisma)"
# npm on Windows writes .cmd shims; the installer runs the POSIX entry point.
rm -rf "${STAGE}/prisma-cli/node_modules/.bin"
mkdir -p "${STAGE}/prisma-cli/node_modules/.bin"
cat > "${STAGE}/prisma-cli/node_modules/.bin/prisma" <<'SH'
#!/bin/sh
exec node "$(dirname "$0")/../prisma/build/index.js" "$@"
SH

# Normalise line endings on the shell entry points (Windows checkouts may be CRLF).
sed -i 's/\r$//' "${STAGE}/start.sh" "${STAGE}/prisma-cli/node_modules/.bin/prisma"

mkdir -p "$(dirname "$OUT")"
# Windows has no exec bit. Pack everything root-owned and world-readable (X keeps
# +x on dirs and shebang scripts), then append the native executables with an
# explicit 0755 so the Linux schema engines can run.
EXECS=( $(cd "$STAGE_ROOT" && find "polysiem-${VERSION}/prisma-cli/node_modules/@prisma/engines" -maxdepth 1 -name 'schema-engine-*') )
TAR_COMMON=(--owner=0 --group=0 --numeric-owner -C "$STAGE_ROOT")
tar "${TAR_COMMON[@]}" --mode='u+rwX,go+rX,go-w' -cf "${OUT%.gz}" "${EXECS[@]/#/--exclude=}" "polysiem-${VERSION}"
tar "${TAR_COMMON[@]}" --mode=0755 -rf "${OUT%.gz}" "${EXECS[@]}"
gzip -f "${OUT%.gz}"
tar -tvzf "$OUT" | grep -E ' polysiem-[^/]+/(start\.sh|prisma-cli/node_modules/(\.bin/prisma|@prisma/engines/schema-engine-.*))$'
echo "Wrote ${OUT} ($(du -h "$OUT" | cut -f1))"
