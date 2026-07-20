import { describe, expect, it } from "vitest";

import { HttpError } from "../http";
import { translateProxmoxProvisioningFailure } from "./provisioner";

const permissionMessage =
  "The Proxmox API token is read-only or lacks container provisioning permissions. " +
  "Use a dedicated token with VM.Allocate, VM.Config.*, Datastore.AllocateSpace, and the required audit permissions on only the intended pool, node, storage, and bridge.";

describe("Proxmox provisioning failure translation", () => {
  it.each([401, 403])("maps HTTP %s to the existing remediation response", (status) => {
    expect(
      translateProxmoxProvisioningFailure(new HttpError(status, "denied")),
    ).toEqual({
      status: 403,
      code: "provider_permission",
      message: permissionMessage,
    });
  });

  it("maps other Proxmox HTTP failures to the existing upstream response", () => {
    expect(
      translateProxmoxProvisioningFailure(new HttpError(409, "conflict")),
    ).toEqual({
      status: 502,
      code: "provider_error",
      message: "Proxmox rejected the request (HTTP 409)",
    });
  });

  it("uses the generic fallback for non-HTTP failures", () => {
    expect(translateProxmoxProvisioningFailure(new Error("Task failed"))).toEqual({
      status: 502,
      code: "provider_error",
      message: "Task failed",
    });
    expect(translateProxmoxProvisioningFailure(null)).toEqual({
      status: 502,
      code: "provider_error",
      message: "The provider request failed",
    });
  });
});
