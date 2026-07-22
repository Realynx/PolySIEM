# Development

This is the guide for working from a local source checkout. If you just want to run PolySIEM somewhere, the [installation guide](INSTALL.md) is what you want instead.

## Prerequisites

You'll need three things on your machine:

- Node.js 22
- npm
- PostgreSQL

Copy [`.env.example`](../.env.example) to `.env`, point `DATABASE_URL` at your database, and generate a unique `APP_SECRET`. Keep the file out of version control. The [configuration reference](CONFIGURATION.md) documents every setting if you need more than the defaults.

## Run locally

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Then open `http://localhost:3000` and walk through the first-run installer to create an administrator. The dev server speaks plain HTTP by default; to mirror production's HTTPS (same self-signed certificate files under `data/certs`), use `npm run dev:https` instead — note there is no HTTP→HTTPS redirect in dev, so use `https://` URLs explicitly. Note that the development seed creates no users or default credentials, and it refuses to run in production unless you set `ALLOW_SEED=true`.

## Common commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Next.js development server with Turbopack. |
| `npm run build` | Create a production build. |
| `npm run db:migrate` | Create or apply development Prisma migrations. |
| `npm run db:deploy` | Apply committed migrations in a deployment. |
| `npm run db:studio` | Open Prisma Studio. |
| `npm run typecheck` | Check TypeScript without emitting files. |
| `npm run lint` | Run ESLint. |
| `npm run codefactor:check` | Enforce zero warnings, complexity ≤15, and no duplicate imports. |
| `npm test` | Run the Vitest suite once. |
| `npm run check` | Run type checking, linting, and tests. |
| `npm run quality:check` | Run every local quality gate, all tests, and the production build. |

## Architecture

PolySIEM is a Next.js 15 App Router application on React 19, Prisma 6, and PostgreSQL. Route handlers serve both the UI and the API, and integration syncs are scheduled in-process via `instrumentation.ts`. That's the whole system: no separate queue, no worker, no sidecar.

Before you extend any application boundary, read the [API contracts](API.md), the [maintainability guide](MAINTAINABILITY.md), and the [domain context](../CONTEXT.md). Architecture decisions live under [`docs/adr`](adr/).

## Demo environments

If you want a mutable local playground, enable Developer mode and Mock integrations in **Settings → Integrations**. The [integration guide](integration-setup.md#demo-mode) covers the available scenarios and stable seeds.

There's also an isolated, read-only public demo stack:

```bash
npm run demo
```

Open `https://localhost:3000` (the container serves HTTPS with a self-signed certificate; plain `http://` redirects there) and select **Sign in**; the form comes pre-filled with `demo` / `polysiem-demo`. This stack runs on its own PostgreSQL volume with coordinated mock integrations, so it won't touch your normal dev database.

```bash
npm run demo:logs
npm run demo:down
```

A startup guard refuses to convert an existing PolySIEM database into a public demo, so you can't do this by accident.

## Verification

Run whatever focused tests are relevant while you iterate. Before opening a change for review, run the full check and a build:

```bash
npm run quality:check
```

Back to the [documentation hub](README.md).
