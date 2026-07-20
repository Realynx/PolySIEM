# Development

This guide covers a local source checkout. For production deployments, use the [installation guide](INSTALL.md).

## Prerequisites

- Node.js 22
- npm
- PostgreSQL

Copy [`.env.example`](../.env.example) to `.env`, set `DATABASE_URL`, generate a unique `APP_SECRET`, and keep the file out of version control. See [configuration](CONFIGURATION.md) for every setting.

## Run locally

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:3000` and use the first-run installer to create an administrator. The development seed creates no users or default credentials and refuses to run in production unless `ALLOW_SEED=true`.

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
| `npm test` | Run the Vitest suite once. |
| `npm run check` | Run type checking, linting, and tests. |

## Architecture

PolySIEM is a Next.js 15 App Router application using React 19, Prisma 6, and PostgreSQL. Route handlers serve the UI and API, while integration synchronization is scheduled in-process through `instrumentation.ts`. There is no separate queue, worker, or sidecar.

Before extending application boundaries, read the [API contracts](API.md), [maintainability guide](MAINTAINABILITY.md), and [domain context](../CONTEXT.md). Architecture decisions are recorded under [`docs/adr`](adr/).

## Demo environments

For a mutable local environment, enable Developer mode and Mock integrations in **Settings → Integrations**. The [integration guide](integration-setup.md#demo-mode) explains scenarios and stable seeds.

To launch the isolated, read-only public demo stack:

```bash
npm run demo
```

Open `http://localhost:3000` and select **Sign in**. The form is pre-filled with `demo` / `polysiem-demo`. The stack uses a separate PostgreSQL volume and coordinated mock integrations.

```bash
npm run demo:logs
npm run demo:down
```

The startup guard refuses to convert an existing PolySIEM database into a public demo.

## Verification

Run focused tests while developing, then use the complete check before opening a change for review:

```bash
npm run check
npm run build
```

Return to the [documentation hub](README.md).
