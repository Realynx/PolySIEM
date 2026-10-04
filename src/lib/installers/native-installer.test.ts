import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MANAGED_SETTING_NAMES } from "@/lib/postgres-tuning/catalog";

const installer = readFileSync(resolve(process.cwd(), "deploy/install-vm.sh"), "utf8");
const releaseWorkflow = readFileSync(resolve(process.cwd(), ".github/workflows/release.yml"), "utf8");
const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
const prismaSchema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
const nativeAutoUpdater = readFileSync(
  resolve(process.cwd(), "deploy/native-auto-update.sh"),
  "utf8",
);

describe("native installer release contract", () => {
  it("uses and verifies the prebuilt Linux x64 bundle", () => {
    expect(installer).toContain("nativeLinuxX64Bundle");
    expect(installer).toContain("SHA256SUMS");
    expect(installer).toContain("checksum verification failed");
    expect(releaseWorkflow).toContain("nativeLinuxX64Bundle");
    expect(releaseWorkflow).toContain('cp deploy/polysiem.service "${STAGE}/polysiem.service"');
  });

  it("packages Prisma query engines for both supported OpenSSL generations", () => {
    expect(prismaSchema).toContain(
      'binaryTargets = ["native", "debian-openssl-1.1.x", "debian-openssl-3.0.x"]',
    );
    expect(releaseWorkflow).toContain(
      "libquery_engine-debian-openssl-1.1.x.so.node",
    );
    expect(releaseWorkflow).toContain(
      "libquery_engine-debian-openssl-3.0.x.so.node",
    );
    expect(releaseWorkflow).toContain(
      'cp -a node_modules/.prisma "${STAGE}/node_modules/.prisma"',
    );
    expect(installer).toContain("release bundle is missing the Prisma OpenSSL 1.1 query engine");
    expect(installer).toContain("release bundle is missing the Prisma OpenSSL 3 query engine");
  });

  it("keeps the source fallback lightweight and ownership scoped", () => {
    expect(installer).toContain("ONNXRUNTIME_NODE_INSTALL=skip npm ci --no-audit --no-fund");
    expect(installer).toContain("No native bundle is published");
    expect(installer).not.toContain('chown -R polysiem:polysiem "$BASE_DIR"');
    expect(installer).toContain('chown root:root "$BASE_DIR" "$RUN_DIR"');
    expect(installer).toContain('chmod 0755 "$BASE_DIR" "$RUN_DIR"');
    expect(installer).toContain("--no-same-owner");
  });

  it("skips an unchanged healthy bundle unless forced", () => {
    expect(installer).toContain("current_release_is_healthy");
    expect(installer).toContain("--force");
    expect(installer).toContain("already installed and healthy; nothing to do");
  });

  it("provisions and documents the locked native demo", () => {
    expect(installer).toContain("--demo");
    expect(installer).toContain("POLYSIEM_DEMO_MODE true");
    expect(installer).toContain("POLYSIEM_DEMO_LOCKED true");
    expect(installer).toContain("POLYSIEM_DEMO_AUTO_SETUP true");
    expect(installer).toContain("POLYSIEM_DEMO_USERNAME demo");
    expect(installer).toContain("POLYSIEM_DEMO_PASSWORD demo");
    expect(installer).toContain("--demo requires a fresh dedicated instance");
    expect(readme).toContain("bash -s -- --demo");
    expect(readme).toContain("**Username:** `demo`");
    expect(readme).toContain("**Password:** `demo`");
    expect(installer).toContain("install_demo_auto_update_timer");
    expect(installer).toContain("polysiem-native-auto-update.timer");
    expect(installer).toContain(
      "systemctl is-enabled --quiet polysiem-native-auto-update.timer",
    );
    expect(releaseWorkflow).toContain("native-auto-update.sh");
    expect(nativeAutoUpdater).toContain('bash "$installer_path" --demo');
    expect(nativeAutoUpdater).toContain("checksum verification failed for install-vm.sh");
    expect(nativeAutoUpdater).toContain("previously failed");
  });

  it("provides an explicit full uninstall without removing shared packages", () => {
    expect(installer).toContain("--uninstall");
    expect(installer).toContain("DROP DATABASE IF EXISTS polysiem WITH (FORCE)");
    expect(installer).toContain("DROP ROLE IF EXISTS polysiem");
    expect(installer).toContain('/opt/polysiem) rm -rf -- "$BASE_DIR"');
    expect(installer).toContain("Shared Node.js and PostgreSQL packages were left installed");
    expect(readme).toContain("bash -s -- --source");
    expect(readme).toContain("bash -s -- --force");
    expect(readme).toContain("bash -s -- --uninstall");
  });
  it("grants exactly the tuned PostgreSQL parameters and installs the restart helper", () => {
    const match = /^POSTGRES_TUNING_PARAMETERS="([^"]+)"$/m.exec(installer);
    expect(match?.[1].split(" ").sort()).toEqual([...MANAGED_SETTING_NAMES].sort());
    expect(installer).toContain("GRANT ALTER SYSTEM ON PARAMETER ${parameter} TO polysiem;");
    expect(installer).toContain("GRANT EXECUTE ON FUNCTION pg_catalog.pg_reload_conf() TO polysiem;");
    expect(installer).toContain('if [ "$pg_version_num" -lt 150000 ]; then');
    expect(installer).toContain("PathExists=${PG_RESTART_REQUEST}");
    expect(installer).toContain("ExecStart=/bin/systemctl restart postgresql");
    expect(installer).toContain('PG_RESTART_REQUEST="${BASE_DIR}/data/postgres-restart.request"');
    // Grants run before the "already healthy" early exit so updates pick them up.
    expect(installer.indexOf("    configure_postgres_tuning\n")).toBeLessThan(
      installer.indexOf("if current_release_is_healthy; then"),
    );
    expect(installer).toContain('rm -f "$PG_RESTART_PATH_UNIT" "$PG_RESTART_SERVICE_UNIT"');
  });
});
