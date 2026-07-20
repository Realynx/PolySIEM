# syntax=docker/dockerfile:1
#
# PolySIEM production image (multi-stage).
#
# The Dockerfile lives in deploy/ but the build context is the REPO ROOT.
# Build with:
#   docker build -f deploy/Dockerfile -t polysiem .
#
# Stages:
#   deps    - install the full npm dependency tree (cached on lockfile)
#   builder - prisma generate + next build (standalone output)
#   runner  - minimal non-root runtime: standalone server + prisma CLI for migrations

# ---------------------------------------------------------------------------
# deps: install dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# builder: generate prisma client and build the Next.js standalone bundle
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time placeholders only: `next build` must never need a live database.
ENV SKIP_ENV_VALIDATION=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    APP_SECRET=build-secret-placeholder-32-characters

RUN npx prisma generate
RUN npm run build

# ---------------------------------------------------------------------------
# runner: minimal runtime image
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
# OpenSSH client supplies ssh + ssh-keyscan for strictly host-key-pinned Edge NAT sessions.
RUN apk add --no-cache libc6-compat openssl openssh-client
WORKDIR /app

ARG POLYSIEM_VERSION=0.1.0
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    POLYSIEM_VERSION=${POLYSIEM_VERSION} \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs polysiem

# Next.js standalone output (server.js + traced node_modules)
COPY --from=builder --chown=polysiem:nodejs /app/.next/standalone ./
COPY --from=builder --chown=polysiem:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=polysiem:nodejs /app/public ./public

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
         "prisma@$(node -p "require('/tmp/app-package.json').devDependencies.prisma")" \
    && npm cache clean --force \
    && rm /tmp/app-package.json \
    # The CLI is installed as root; the non-root runtime user must be able to
    # write engine checksum markers under @prisma/engines, so hand it ownership.
    && chown -R polysiem:nodejs /opt/prisma-cli
ENV PRISMA_BIN=/opt/prisma-cli/node_modules/.bin/prisma \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    CHECKPOINT_DISABLE=1

COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Strip CR in case the file was checked out with CRLF line endings on Windows
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

USER polysiem
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
