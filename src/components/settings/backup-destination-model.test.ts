import { describe, expect, it } from "vitest";
import {
  buildDestinationConfig,
  destinationFormForEdit,
  destinationHasStoredSecret,
  emptyDestinationForm,
} from "./backup-destination-model";

describe("backup destination form model", () => {
  it("keeps write-only S3 secrets on edit and trims non-secret fields", () => {
    const form = emptyDestinationForm("s3");
    Object.assign(form, {
      endpoint: "  https://s3.example  ",
      region: " us-east-2 ",
      bucket: " backups ",
      s3Prefix: " polysiem/ ",
      accessKeyId: " access ",
    });
    expect(buildDestinationConfig(form, true)).toEqual({
      endpoint: "https://s3.example",
      region: "us-east-2",
      bucket: "backups",
      prefix: "polysiem/",
      accessKeyId: "access",
      forcePathStyle: false,
    });
  });

  it("sends newly entered Azure secrets for both authentication modes", () => {
    const sas = emptyDestinationForm("azure");
    sas.sasUrl = " https://storage.example/container?sig=secret ";
    expect(buildDestinationConfig(sas, false)).toEqual({ mode: "sas", sasUrl: "https://storage.example/container?sig=secret" });

    const shared = emptyDestinationForm("azure");
    Object.assign(shared, { azureMode: "sharedKey", accountName: " account ", accountKey: " key ", container: " backups " });
    expect(buildDestinationConfig(shared, false)).toMatchObject({
      mode: "sharedKey",
      accountName: "account",
      accountKey: "key",
      container: "backups",
    });
  });

  it("hydrates only non-secret edit fields and reports stored secret markers", () => {
    const editable = {
      id: "destination-1",
      name: "Offsite",
      type: "s3" as const,
      config: { endpoint: "https://s3.example", bucket: "backups", hasSecretAccessKey: true },
    };
    const form = destinationFormForEdit(editable);
    expect(form).toMatchObject({ name: "Offsite", endpoint: "https://s3.example", bucket: "backups", secretAccessKey: "" });
    expect(destinationHasStoredSecret(form, editable)).toBe(true);
  });
});
