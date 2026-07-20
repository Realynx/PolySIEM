import { describe, expect, it } from "vitest";
import { conciseChildTitle } from "./titles";

describe("conciseChildTitle", () => {
  it.each([
    ["Nextcloud — Backup & Recovery", "Nextcloud", "Backup & Recovery"],
    ["Nextcloud - Network & Access", "Nextcloud", "Network & Access"],
    ["NEXTCLOUD: Troubleshooting", "Nextcloud", "Troubleshooting"],
  ])("removes a repeated parent prefix from %s", (title, parent, expected) => {
    expect(conciseChildTitle(title, parent)).toBe(expected);
  });

  it("preserves an independently meaningful child title", () => {
    expect(conciseChildTitle("Disaster Recovery", "Nextcloud")).toBe(
      "Disaster Recovery",
    );
  });
});
