import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const installer = readFileSync(resolve(process.cwd(), "deploy/install.sh"), "utf8");
const updater = readFileSync(resolve(process.cwd(), "deploy/update.sh"), "utf8");
const agent = readFileSync(resolve(process.cwd(), "deploy/auto-update.sh"), "utf8");

describe("managed Docker browser-update contract", () => {
  it("installs an isolated, frequently polling host agent", () => {
    expect(installer).toContain("POLYSIEM_UPDATE_AGENT_TOKEN=");
    expect(installer).toContain("POLYSIEM_AUTO_UPDATE_CAPABLE=");
    expect(installer).toContain("OnUnitActiveSec=30s");
    expect(installer).toContain("ExecStart=${INSTALL_DIR}/auto-update.sh");
  });

  it("claims browser requests and reports their terminal status", () => {
    expect(agent).toContain('manual_requested="$(response_value manualRequested)"');
    expect(agent).toContain('report_request_status "installing"');
    expect(agent).toContain('report_request_status "completed"');
    expect(agent).toContain('report_request_status "failed"');
    expect(agent).toContain('check_url="${UPDATE_ENDPOINT}?check=true"');
  });

  it("upgrades existing timer cadence along with the updater", () => {
    expect(updater).toContain("polysiem-auto-update.timer");
    expect(updater).toContain("OnUnitActiveSec=30s");
    expect(updater).toContain('cp "$auto_update_candidate" "${INSTALL_DIR}/auto-update.sh"');
  });
});
