import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const installer = readFileSync(resolve(process.cwd(), "deploy/install-vm.sh"), "utf8");
const releaseWorkflow = readFileSync(resolve(process.cwd(), ".github/workflows/release.yml"), "utf8");
const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");

describe("native installer release contract", () => {
  it("uses and verifies the prebuilt Linux x64 bundle", () => {
    expect(installer).toContain("nativeLinuxX64Bundle");
    expect(installer).toContain("SHA256SUMS");
    expect(installer).toContain("checksum verification failed");
    expect(releaseWorkflow).toContain("nativeLinuxX64Bundle");
    expect(releaseWorkflow).toContain('cp deploy/polysiem.service "${STAGE}/polysiem.service"');
  });

  it("keeps the source fallback lightweight and ownership scoped", () => {
    expect(installer).toContain("ONNXRUNTIME_NODE_INSTALL=skip npm ci --no-audit --no-fund");
    expect(installer).toContain("No native bundle is published");
    expect(installer).not.toContain('chown -R polysiem:polysiem "$BASE_DIR"');
  });

  it("skips an unchanged healthy bundle unless forced", () => {
    expect(installer).toContain("current_release_is_healthy");
    expect(installer).toContain("--force");
    expect(installer).toContain("already installed and healthy; nothing to do");
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
});
