import { describe, expect, it } from "vitest";
import { integrationFetchErrorMessage } from "./http";

function fetchFailure(code: string, message: string): TypeError {
  return Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error(message), { code }),
  });
}

describe("integration fetch errors", () => {
  it("explains self-signed TLS failures", () => {
    expect(
      integrationFetchErrorMessage(
        "https://10.0.0.4:8006/api2/json/nodes",
        fetchFailure("DEPTH_ZERO_SELF_SIGNED_CERT", "self-signed certificate"),
      ),
    ).toContain("turn off “Verify TLS certificate”");
  });

  it("explains unreachable services without exposing the full request URL", () => {
    const message = integrationFetchErrorMessage(
      "https://pve.internal:8006/api2/json/nodes",
      fetchFailure("ECONNREFUSED", "connect refused"),
    );
    expect(message).toContain("pve.internal:8006");
    expect(message).not.toContain("/api2/json/nodes");
  });
});
