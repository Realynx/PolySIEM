# Configuration

PolySIEM reads its server configuration from environment variables. Installers generate a `.env` file automatically; source and manual Compose installations can start from [`.env.example`](../.env.example).

## Required settings

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string, such as `postgresql://polysiem:password@db:5432/polysiem`. |
| `APP_SECRET` | Secret used to encrypt integration credentials at rest. Generate one with `openssl rand -hex 32`. |
| `APP_URL` | Public base URL of the instance, such as `http://10.0.0.5:3000`. PolySIEM uses it for canonical and social-card links and in generated MCP configuration. |

Keep `APP_SECRET` with every database backup. If it is lost or changed, the encrypted credentials in that database cannot be recovered and must be entered again.

## Deployment settings

| Variable | Required | Description |
|---|---|---|
| `DB_PASSWORD` | Docker Compose | Password for the bundled PostgreSQL container. It must match the password in `DATABASE_URL`. |
| `PORT` | No | Application listen port. The container defaults to `3000`. |
| `HOSTNAME` | No | Application listen interface. The container defaults to `0.0.0.0`. |
| `POLYSIEM_IMAGE` | No | Container image used by release-based Compose installations. |
| `POLYSIEM_GITHUB_REPOSITORY` | No | Repository used for release and update metadata. Defaults to `Realynx/PolySIEM`. |
| `POLYSIEM_AUTO_UPDATE_CAPABLE` | Installer-managed | Enables the automatic-update toggle when the root-owned Linux update timer is installed. |
| `POLYSIEM_UPDATE_AGENT_TOKEN` | Installer-managed | Random bearer token used only between the local update timer and PolySIEM. Treat it as a secret. |

Changing the externally visible port also requires updating the Compose port mapping or native service configuration and `APP_URL`. See [installation troubleshooting](INSTALL.md#ports).

## Development and demo settings

| Variable | Description |
|---|---|
| `MOCK_AI` | Makes `/api/ai` return deterministic responses without a running Ollama instance. |
| `POLYSIEM_DEMO_MODE` | Enables mock-integration controls for a mutable development demo. |
| `POLYSIEM_DEMO_LOCKED` | Locks persistent mutations in the dedicated public demo. |
| `POLYSIEM_DEMO_AUTO_SETUP` | Bootstraps the dedicated public demo database. |

Use the locked and auto-setup flags only through `deploy/docker-compose.demo.yml`. Never point that stack at a real PolySIEM database. See [demo mode](integration-setup.md#demo-mode) for the supported workflows.

The public demo stack automatically follows the verified `latest` release image. Ordinary installations default automatic updates to **off**. Managed Linux Docker installs can opt in under **Settings → System**; updates still use the backup, health-check, and rollback workflow described in the installation guide.

## Example

```dotenv
DATABASE_URL="postgresql://polysiem:replace-me@localhost:5432/polysiem"
APP_SECRET="replace-with-output-from-openssl-rand-hex-32"
APP_URL="http://localhost:3000"
```

Do not commit a populated `.env` file. For backup and restore instructions, see the [installation guide](INSTALL.md#backup--restore).

Return to the [documentation hub](README.md).
