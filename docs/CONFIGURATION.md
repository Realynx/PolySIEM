# Configuration

PolySIEM reads its server configuration from environment variables. If you used one of the installers, a `.env` file was generated for you. For source builds and hand-rolled Compose setups, copy [`.env.example`](../.env.example) and fill it in.

## Required settings

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string, such as `postgresql://polysiem:password@db:5432/polysiem`. |
| `APP_SECRET` | Secret used to encrypt integration credentials at rest. Generate one with `openssl rand -hex 32`. |
| `APP_URL` | Public base URL of the instance, such as `http://10.0.0.5:3000`. PolySIEM uses it for canonical and social-card links and in generated MCP configuration. |

One thing worth repeating: keep `APP_SECRET` with every database backup. It encrypts your integration credentials, so if it's lost or changed, those credentials cannot be recovered and you'll be typing them all in again.

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

If you change the externally visible port, remember that the Compose port mapping (or native service configuration) and `APP_URL` need to change with it. See [installation troubleshooting](INSTALL.md#ports).

## Development and demo settings

| Variable | Description |
|---|---|
| `MOCK_AI` | Makes `/api/ai` return deterministic responses without a running Ollama instance. |
| `POLYSIEM_DEMO_MODE` | Enables mock-integration controls for a mutable development demo. |
| `POLYSIEM_DEMO_LOCKED` | Locks persistent mutations in the dedicated public demo. |
| `POLYSIEM_DEMO_AUTO_SETUP` | Bootstraps the dedicated public demo database. |

The locked and auto-setup flags are only meant to be set through `deploy/docker-compose.demo.yml` or the native installer's `--demo` flag. Both expect a dedicated demo database of their own; never point them at a real PolySIEM database. The supported workflows are described under [demo mode](integration-setup.md#demo-mode).

The public demo stack follows the verified `latest` release image automatically. Ordinary installations ship with automatic updates **off**. Managed Linux Docker installs can opt in under **Settings → System**, and updates still go through the backup, health-check, and rollback workflow described in the installation guide.

## Example

```dotenv
DATABASE_URL="postgresql://polysiem:replace-me@localhost:5432/polysiem"
APP_SECRET="replace-with-output-from-openssl-rand-hex-32"
APP_URL="http://localhost:3000"
```

Don't commit a populated `.env` file. Backup and restore is covered in the [installation guide](INSTALL.md#backup--restore).

Return to the [documentation hub](README.md).
