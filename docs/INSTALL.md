# PolySIEM — Installation, upgrade & troubleshooting

This is the long-form companion to the [README install section](../README.md#install). If you're after the other guides, they're all listed in the [documentation hub](README.md).

## Contents

- [Requirements](#requirements)
- [Option 1: Linux Docker installer](#option-1-linux-docker-installer)
- [Option 2: Windows Docker Desktop installer](#option-2-windows-docker-desktop-installer)
- [Option 3: Manual Docker Compose](#option-3-manual-docker-compose)
- [Option 4: Build from source (Docker)](#option-4-build-from-source-docker)
- [Option 5: Native Linux VM install](#option-5-native-linux-vm-install)
- [First run](#first-run)
- [Upgrading](#upgrading)
- [Backup & restore](#backup--restore)
- [Moving data to another machine](#moving-data-to-another-machine)
- [Troubleshooting](#troubleshooting)

## Requirements

You'll need a Linux host, a VM/LXC, or a Windows 10/11 machine. PolySIEM is a homelab tool and runs PostgreSQL right beside the application, so plan for both.

- Linux Docker path: Debian/Ubuntu or Fedora/RHEL family. Any other distro can use the manual Compose path instead.
- Windows path: Docker Desktop configured for Linux containers.
- Native, non-Docker path: Debian/Ubuntu only.
- ~1 GB RAM free, a couple of GB of disk.
- Port **3000** free (see [Ports](#ports)).

## Option 1: Linux Docker installer

```bash
curl -fsSL https://github.com/Realynx/PolySIEM/releases/latest/download/install.sh | bash
```

Here's what the script actually does:

1. Re-executes itself with `sudo` if needed.
2. Installs Docker (get.docker.com) and the compose plugin if missing.
3. Creates `/opt/polysiem` (override with `INSTALL_DIR=/somewhere`).
4. Generates `/opt/polysiem/.env` with fresh `APP_SECRET`, `DB_PASSWORD`, `DATABASE_URL`, `APP_URL` — only if it doesn't already exist.
5. Downloads `docker-compose.yml` and the updater from the same GitHub Release, pulls `ghcr.io/realynx/polysiem:latest`, and starts PolySIEM + PostgreSQL 17.
6. Waits for `GET /api/health` to go green and prints the URL.

Running it again is safe. Your `.env` is kept, a newer image is pulled, and the containers are restarted.

Environment overrides: `INSTALL_DIR`, `POLYSIEM_REPO` (repo URL), `POLYSIEM_BRANCH` (source mode only).

## Option 2: Windows Docker Desktop installer

Install and start [Docker Desktop](https://www.docker.com/products/docker-desktop/) using Linux containers. Then open PowerShell and run:

```powershell
irm https://github.com/Realynx/PolySIEM/releases/latest/download/install.ps1 | iex
```

The script validates Docker, creates `%LOCALAPPDATA%\PolySIEM`, generates `.env` with cryptographically random database/encryption secrets, downloads the matching release Compose file and updater, starts the stack, and waits for health. If you want it somewhere else, set `POLYSIEM_INSTALL_DIR`; to point at a fork, set `POLYSIEM_GITHUB_REPOSITORY`.

Day-to-day service management from PowerShell:

```powershell
cd "$env:LOCALAPPDATA\PolySIEM"
docker compose ps
docker compose logs -f polysiem
docker compose restart polysiem
```

## Option 3: Manual Docker Compose

Prefer to see exactly what runs on your box? Grab the Compose file yourself:

```bash
mkdir -p /opt/polysiem && cd /opt/polysiem
curl -fL -o docker-compose.yml https://github.com/Realynx/PolySIEM/releases/latest/download/docker-compose.yml
```

Create `.env` next to it:

```dotenv
DB_PASSWORD=<openssl rand -hex 24>
APP_SECRET=<openssl rand -hex 32>
APP_URL=https://<your-server-ip>:3000
DATABASE_URL=postgresql://polysiem:<same DB_PASSWORD>@db:5432/polysiem
```

Then:

```bash
docker compose up -d
```

You don't need to run migrations by hand. They run automatically every time the `polysiem` container starts — the entrypoint retries until PostgreSQL is up, then runs `prisma migrate deploy`.

## Option 4: Build from source (Docker)

Either use the installer flag:

```bash
curl -fsSL https://raw.githubusercontent.com/Realynx/PolySIEM/master/deploy/install.sh | bash -s -- --source
```

…or manually from a checkout (`.env` at the repo root, `DATABASE_URL` host must be `db`):

```bash
git clone https://github.com/Realynx/PolySIEM polysiem && cd polysiem
docker compose --env-file .env -f deploy/docker-compose.source.yml up -d --build
```

To build just the image: `docker build -f deploy/Dockerfile -t polysiem .` (note: the Dockerfile lives in `deploy/` but the **build context is the repo root**).

## Option 5: Native Linux VM install

For a Debian/Ubuntu VM or LXC (e.g. on Proxmox), no Docker involved:

```bash
curl -fsSL https://github.com/Realynx/PolySIEM/releases/latest/download/install-vm.sh | bash
```

This one does a fair bit: it installs Node 22 (NodeSource) + distro PostgreSQL, creates a `polysiem` system user and database, downloads the exact x86-64 standalone bundle named by the latest release manifest, verifies it against the release's `SHA256SUMS`, writes `/opt/polysiem/.env`, applies migrations, switches the runtime in `/opt/polysiem/run`, and installs a hardened systemd unit (`polysiem.service`: `NoNewPrivileges`, `ProtectSystem=full`, `PrivateTmp`). If you re-run it against an unchanged healthy release, it notices and exits without reinstalling anything.

On architectures without a published native bundle, the installer falls back to building the selected release from source. There are a few flags worth knowing: `--demo` on a fresh dedicated instance provisions an immutable sample environment with the `demo` / `demo` login, `--source` requests a source build explicitly, `--force` repairs or reinstalls the current bundle, and `--uninstall` permanently removes PolySIEM:

```bash
curl -fsSL https://github.com/Realynx/PolySIEM/releases/latest/download/install-vm.sh | bash -s -- --demo
curl -fsSL https://github.com/Realynx/PolySIEM/releases/latest/download/install-vm.sh | bash -s -- --source
curl -fsSL https://github.com/Realynx/PolySIEM/releases/latest/download/install-vm.sh | bash -s -- --force
curl -fsSL https://github.com/Realynx/PolySIEM/releases/latest/download/install-vm.sh | bash -s -- --uninstall
```

`--demo` enables the locked public-demo boundary, auto-creates the demo account and coordinated mock integrations, and skips the setup wizard. A root-owned systemd timer checks every 15 minutes for a verified release, then uses the same native backup, migration, health-check, and rollback path. A failed version is not retried automatically. Demo mode refuses to convert an existing normal installation; use `--uninstall` first, and only when that instance's data can be deleted.

`--uninstall` deletes the PolySIEM PostgreSQL database and role, `/opt/polysiem` (including `.env` and every installer backup), the systemd unit, and the `polysiem` system user. The shared Node.js and PostgreSQL OS packages are left installed.

Service management:

```bash
systemctl status polysiem
journalctl -u polysiem -f
systemctl restart polysiem
```

## First run

Open `https://<your-server>:3000` (the first-boot self-signed certificate triggers a one-time browser warning; replace it later under **Settings → Web certificate**). PolySIEM launches the first-run installer — there are no default credentials to hunt for. Pick the administrator username and password, optionally connect integrations, then view or skip the isolated mock dashboard tutorial. You can always add integrations later under **Admin → Integrations**; see [integration-setup.md](integration-setup.md) for least-privilege credentials or generated mock scenarios.

## Upgrading

| Install type | How |
|---|---|
| Linux Docker installer | `sudo /opt/polysiem/update.sh` |
| Windows Docker Desktop | `powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\PolySIEM\update.ps1"` |
| Docker (manual) | Download `deploy/update.sh` to the install directory and run it as root |
| Docker (source) | `git -C /opt/polysiem/src pull && docker compose --env-file /opt/polysiem/.env -f /opt/polysiem/src/deploy/docker-compose.source.yml up -d --build` |
| Native VM/LXC | Re-run `install-vm.sh` (verified bundle → backup → migrate → restart) |

Not sure whether you're behind? Admins can use **Settings → About → Check for updates** to compare the running build with GitHub's latest stable release. On managed Linux Docker installations, choose **Install** to open the independent update window. It queues a database-backed request for the root-owned host agent, follows backup, installation, restart, health-check, and rollback status, and reconnects automatically while the application restarts. Browser clients never call GitHub directly, and the application never receives Docker or root access.

Managed Linux Docker installs also expose an **Automatic updates** toggle under **Settings → System**. It is off by default. The root-owned agent polls locally for browser requests every 30 seconds and, when automatic updates are enabled, checks GitHub for a verified release every 15 minutes. It invokes the same transactional updater described below. A failed unattended release is rolled back and is not retried automatically; inspect the preserved backup before retrying from the update window. PolySIEM itself never receives Docker access or root privileges.

If your Linux Docker install predates this feature, rerun the latest `install.sh` once. The installer preserves `.env` and data, adds the local update-agent token, and installs the timer; the toggle remains off until an administrator enables it.

The Linux and Windows Docker updaters perform this sequence:

1. Takes a custom-format `pg_dump` and copies `.env` plus `docker-compose.yml` to `/opt/polysiem/backups/pre-update-<UTC timestamp>/`.
2. Stops the application so no writes can occur after the backup.
3. Downloads and validates `docker-compose.yml` from the latest GitHub Release, pulls the release image, and starts it. The container applies committed Prisma migrations with `prisma migrate deploy` before the server starts.
4. Waits for the database-backed health endpoint. On failure it stops the new app, restores the database and Compose file, and starts the tagged previous image.

The updater deliberately keeps both the backup and the rollback image after success. Linux stores backups under `/opt/polysiem/backups`; Windows stores them under `%LOCALAPPDATA%\PolySIEM\backups`. Remove old copies only after you have verified the release — no automatic retention policy guesses how much recovery history your homelab can afford.

### Release artifacts

Every tagged release is published only after all of these are ready:

- A GHCR image manifest supporting `linux/amd64` and `linux/arm64`. Docker Desktop uses these Linux-container images on Windows.
- `install.sh`, `update.sh`, `auto-update.sh`, `install-vm.sh`, and `native-auto-update.sh` for Linux.
- `install.ps1` and `update.ps1` for Windows.
- `docker-compose.yml`, `release-manifest.json`, and `SHA256SUMS`.
- Versioned platform-specific native bundles: `polysiem-<version>-standalone-linux-x64.tar.gz` and `polysiem-<version>-standalone-windows-x64.zip`. Each contains a matching Prisma CLI and a `start.sh` or `start.ps1` entrypoint that applies migrations before starting Node. The Linux bundle also contains the native systemd unit.

Installers and updaters consume the stable `releases/latest/download/...` assets, not mutable deployment files from `master`. `SHA256SUMS` covers every published artifact.

The native installer follows the same principle: it downloads, checksum-verifies, and stages the new runtime first, stops the service, backs up PostgreSQL, `.env`, and `/opt/polysiem/run`, then migrates and switches the runtime. A source build is used only when explicitly requested or when no bundle exists for the host architecture. If a migration or health check fails, the saved database and runtime are restored.

Source-mode Docker installs are developer-oriented and are not switched by the release-image updater. Take the database and `.env` backup below, build the new image, and keep the prior local image tag around until the new build is healthy.

### Migration policy

Prisma migrations are forward-only, but release migrations must remain operationally reversible through backup restore. In practice that means:

- Commit every production schema change under `prisma/migrations`; never use `prisma db push` during an update.
- Prefer expand/backfill/contract changes. Add nullable columns or new tables first, deploy code that understands both shapes, backfill separately, and only remove old fields in a later release.
- Avoid long data rewrites in container startup migrations. Put large backfills in an idempotent, observable maintenance task.
- Never edit a migration after it has shipped. Fix it with a new migration.
- A database restored to the pre-update schema must run only with the pre-update app image/runtime. The update scripts restore these as a pair.

## Backup & restore

The admin **Settings → Backup & restore** page can download and restore a full logical archive. Enter a backup password before downloading to create a portable `.psbackup` file. That file includes the key material needed for integration credentials, personal OTX keys, hosted-AI keys, backup-destination credentials, and stored TLS private keys; the entire file is protected with scrypt and AES-256-GCM. On another instance, enter the same password during restore and PolySIEM re-encrypts those values with the destination's `APP_SECRET`. The password is not stored and cannot be recovered.

An unprotected `.json.gz` export keeps credential ciphertext as stored and is suitable only when the restoring instance uses the same `APP_SECRET`. Scheduled cloud backups currently use this same-instance form. For portable disaster recovery, keep a password-protected download off-box.

There are **two** things to back up — the database and `.env`:

```bash
# Docker
cd /opt/polysiem
docker compose exec db pg_dump -U polysiem polysiem > polysiem-$(date +%F).sql
cp .env polysiem-env-backup

# Native
sudo -u postgres pg_dump polysiem > polysiem-$(date +%F).sql
cp /opt/polysiem/.env polysiem-env-backup
```

Restore (Docker):

```bash
cd /opt/polysiem
docker compose up -d db
cat polysiem-2026-07-17.sql | docker compose exec -T db psql -U polysiem polysiem
docker compose up -d
```

Transactional updater backups use PostgreSQL's custom format instead of SQL text. To restore one manually, stop PolySIEM, recreate the `public` schema, and feed the dump to `pg_restore`:

```bash
cd /opt/polysiem
docker compose stop polysiem
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U polysiem -d polysiem \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
docker compose exec -T db pg_restore --exit-on-error --no-owner --no-privileges \
  -U polysiem -d polysiem < backups/pre-update-YYYYMMDDTHHMMSSZ/polysiem.dump
docker compose up -d polysiem
```

> **`APP_SECRET` matters:** integration credentials (Proxmox/OPNsense/Elasticsearch) are encrypted with it. Restore the database with a *different* `APP_SECRET` and every integration credential will need to be re-entered. Restore the original `.env` alongside the dump.

## Moving data to another machine

1. On the old box: take a `pg_dump` and copy `.env` (see above).
2. On the new box: run the installer, then **stop before opening the wizard**: `cd /opt/polysiem && docker compose stop polysiem`.
3. Replace the generated `/opt/polysiem/.env` with your old one (keep the new file's `APP_URL` if the IP changed).
4. Restore the dump into the new `db` container, then `docker compose up -d`.

The named volume `polysiem-pgdata` holds the database files. You could move the raw volume with `docker run --rm -v polysiem-pgdata:/data -v $PWD:/backup alpine tar czf /backup/pgdata.tar.gz -C /data .`, but a `pg_dump` across Postgres versions is safer.

## Troubleshooting

### Ports

PolySIEM listens on **3000** (mapped `3000:3000` in compose; `PORT=3000` in the systemd unit). To change it:

- Docker: edit the `ports:` mapping in `docker-compose.yml` (e.g. `"8080:3000"`) and update `APP_URL`.
- Native: override `PORT` via a systemd drop-in (`systemctl edit polysiem` → `[Service]` `Environment=PORT=8080`) and update `APP_URL`.

PostgreSQL is **not** published to the host in the compose setup — only the `polysiem` container can reach it. The native install uses local PostgreSQL on `localhost:5432`.

### Self-signed TLS on integrations

Homelab Proxmox/OPNsense boxes usually run self-signed certificates. Each integration in **Admin → Integrations** has a *"allow self-signed / skip TLS verification"* toggle. Enabling it means PolySIEM will not verify that endpoint's certificate chain — fine on a trusted LAN, but it removes man-in-the-middle protection for that connection. Prefer installing a proper internal CA cert where you can.

### Health check

`GET /api/health` returns `{"status":"ok","database":"up"}` (200) when the app can reach PostgreSQL, and 503 otherwise. The Docker healthcheck and the installers poll this endpoint.

```bash
# -kL follows the HTTP→HTTPS redirect and accepts the self-signed certificate
curl -skL http://localhost:3000/api/health
```

### Container keeps restarting / "database is still unreachable"

The entrypoint retries `prisma migrate deploy` ~30 times, 2s apart, before giving up. Check:

```bash
docker compose logs db        # is Postgres healthy?
docker compose logs polysiem   # what does the migration say?
grep DATABASE_URL .env        # host must be `db` in the compose setup
```

### Resetting the admin password

If you lock yourself out, set a new bcrypt hash directly in the database. Generate a hash and update the user in one go:

```bash
# Docker install (replace NEWPASSWORD and the email):
HASH=$(docker compose exec polysiem node -e "require('bcryptjs').hash('NEWPASSWORD',10).then(h=>console.log(h))")
docker compose exec db psql -U polysiem polysiem \
  -c "UPDATE \"User\" SET \"passwordHash\" = '$HASH' WHERE email = 'admin@example.com';"

# Native install:
HASH=$(cd /opt/polysiem/run && node -e "require('bcryptjs').hash('NEWPASSWORD',10).then(h=>console.log(h))")
sudo -u postgres psql polysiem \
  -c "UPDATE \"User\" SET \"passwordHash\" = '$HASH' WHERE email = 'admin@example.com';"
```

(Adjust the table/column names if the schema differs in your version — check with `\d` in psql.)

### "Wizard doesn't appear / goes to login instead"

The wizard only shows while no admin account exists. If setup already ran, use the login page; to start over on a fresh instance, drop the database volume: `docker compose down -v` (**destroys all data**) and `docker compose up -d`.

### Logs

- Docker: `docker compose logs -f polysiem`
- Native: `journalctl -u polysiem -f`
