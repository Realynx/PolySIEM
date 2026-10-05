# syntax=docker/dockerfile:1
#
# PolySIEM production image (multi-stage).
#
# The Dockerfile lives in deploy/ but the build context is the REPO ROOT.
# Build with:
#   docker build -f deploy/Dockerfile -t polysiem .
#
# Stages:
#   deps          - install the full npm dependency tree (cached on lockfile)
#   builder       - prisma generate + next build (standalone output)
#   proxy-builder - statically-linked musl build of the privacy router's SNI proxy
#   runner        - minimal non-root runtime: standalone server + prisma CLI for migrations

# Global build args must be declared before the first FROM to be usable in one.
# The privacy proxy artefact is always x86_64 regardless of the image's own platform
# - see the proxy-builder stage for why.
ARG PRIVACY_PROXY_PLATFORM=linux/amd64

# ---------------------------------------------------------------------------
# deps: install dependencies
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
# onnxruntime-node publishes glibc-linked Linux binaries. Alpine uses musl and
# cannot load them (for example, __vsnprintf_chk is unavailable there).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgomp1 openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
# The arm64 half of the release build runs under QEMU, where registry fetches
# time out far more often; npm's defaults (2 retries, 10–60s backoff) let one
# dropped connection fail the whole multi-arch release.
ENV NPM_CONFIG_FETCH_RETRIES=6 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=180000
# The app uses the CPU execution provider. onnxruntime-node otherwise downloads
# the large CUDA 12 provider bundle on linux/x64 during its postinstall step.
RUN ONNXRUNTIME_NODE_INSTALL=skip npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# builder: generate prisma client and build the Next.js standalone bundle
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgomp1 openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time placeholders only: `next build` must never need a live database.
ENV SKIP_ENV_VALIDATION=1 \
    NEXT_TELEMETRY_DISABLED=1

RUN npx prisma generate
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    APP_SECRET=build-secret-placeholder-32-characters \
    npm run build

# ---------------------------------------------------------------------------
# proxy-builder: the privacy router's SNI proxy, as a static musl binary
#
# This binary is a PAYLOAD, not part of the runtime image: PolySIEM serves it to
# a managed privacy router, which verifies its sha256 and installs it. Nothing in
# this image ever executes it.
#
# `--platform=linux/amd64` is therefore deliberate and is NOT the image's own
# platform. v1 supports x86_64 routers only, so the artifact must be x86_64 even
# when the image itself is being built for arm64 - otherwise an arm64 build of
# PolySIEM would quietly ship a binary no router can execute. On an arm64 builder
# this stage runs under emulation, which is slow but correct; widening router
# support means adding a target here, not editing a router.
#
# Static musl: no glibc dependency, so one artifact runs on Debian, Ubuntu and
# Alpine routers alike.
# ---------------------------------------------------------------------------
FROM --platform=${PRIVACY_PROXY_PLATFORM} rust:1-alpine AS proxy-builder
# `rust:alpine` ships the toolchain but not a linker or the musl C runtime.
RUN apk add --no-cache musl-dev
WORKDIR /src
COPY native/privacy-proxy ./privacy-proxy
WORKDIR /src/privacy-proxy
# `--locked` so the shipped binary is reproducible from the committed Cargo.lock
# rather than from whatever the registry resolved to today. The release profile
# strips symbols itself (see Cargo.toml); alpine has no binutils.
RUN cargo build --release --target x86_64-unknown-linux-musl --locked \
    && install -D -m 0755 \
         target/x86_64-unknown-linux-musl/release/polysiem-privacy-proxy \
         /out/polysiem-privacy-proxy-x86_64 \
    # Bare lowercase hex, no filename column: every consumer wants just the
    # digest, and `sha256sum`'s two-column format has bitten shell readers here
    # before. PolySIEM recomputes this from the binary at runtime anyway - the
    # sidecar exists so the image can be audited without hashing anything.
    && sha256sum /out/polysiem-privacy-proxy-x86_64 | cut -d' ' -f1 \
         > /out/polysiem-privacy-proxy-x86_64.sha256 \
    # Fail the build rather than ship something a router cannot run.
    && test -s /out/polysiem-privacy-proxy-x86_64.sha256 \
    && /out/polysiem-privacy-proxy-x86_64 --version

# ---------------------------------------------------------------------------
# runner: minimal runtime image
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner
# OpenSSH client supplies ssh + ssh-keyscan for strictly host-key-pinned Edge NAT sessions.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         ca-certificates libgomp1 openssh-client openssl wget \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

ARG POLYSIEM_VERSION=0.1.0
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    POLYSIEM_VERSION=${POLYSIEM_VERSION} \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --create-home polysiem

# Next.js standalone output (server.js + traced node_modules)
COPY --from=builder --chown=polysiem:nodejs /app/.next/standalone ./
COPY --from=builder --chown=polysiem:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=polysiem:nodejs /app/public ./public

# HTTPS entrypoint: terminates TLS with a self-signed (or admin-uploaded)
# certificate and redirects plain-HTTP requests. Certificates live under
# /app/data (persist it with a volume; the DB copy restores them regardless).
COPY --from=builder --chown=polysiem:nodejs /app/server/tls-server.js /app/server/cert-utils.js ./
RUN mkdir -p /app/data/certs && chown -R polysiem:nodejs /app/data
ENV POLYSIEM_CERT_DIR=/app/data/certs

# Prisma schema + migrations, applied by the entrypoint at container start
COPY --from=builder --chown=polysiem:nodejs /app/prisma ./prisma

# Generated Prisma client (belt-and-suspenders next to the traced copy)
COPY --from=builder --chown=polysiem:nodejs /app/node_modules/.prisma ./node_modules/.prisma

# Prisma CLI for `prisma migrate deploy` at runtime, installed into an isolated
# directory. (Copying node_modules/prisma + @prisma from the deps stage is NOT
# enough: the CLI has transitive deps outside the @prisma scope, e.g. `effect`.)
# The version is read from the app's package.json so it stays in sync.
COPY --from=deps /app/package.json /tmp/app-package.json
RUN cd /opt \
    && mkdir prisma-cli && cd prisma-cli \
    && npm install --no-save --omit=dev --no-audit --no-fund \
         --fetch-retries=6 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=180000 \
         "prisma@$(node -p "require('/tmp/app-package.json').devDependencies.prisma")" \
    && npm cache clean --force \
    && rm /tmp/app-package.json \
    # The CLI is installed as root; the non-root runtime user must be able to
    # write engine checksum markers under @prisma/engines, so hand it ownership.
    && chown -R polysiem:nodejs /opt/prisma-cli
ENV PRISMA_BIN=/opt/prisma-cli/node_modules/.bin/prisma \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    CHECKPOINT_DISABLE=1

# Privacy router SNI proxy, served to managed routers over the authenticated HTTP
# path and verified by sha256 before it is installed. Read-only to the runtime
# user: PolySIEM only ever hashes it and streams it out.
COPY --from=proxy-builder --chown=polysiem:nodejs \
     /out/polysiem-privacy-proxy-x86_64 \
     /out/polysiem-privacy-proxy-x86_64.sha256 \
     /app/assets/privacy-proxy/
ENV POLYSIEM_PRIVACY_PROXY_DIR=/app/assets/privacy-proxy

COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Strip CR in case the file was checked out with CRLF line endings on Windows
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

USER polysiem
EXPOSE 3000

# /api/health always answers over plain HTTP (tls-server.js passes it through
# to the app instead of redirecting), so one probe covers TLS on and off.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
