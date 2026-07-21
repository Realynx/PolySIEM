import type { DestinationType } from "@/lib/backup/types";

export interface DestinationForm {
  type: DestinationType;
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  s3Prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  azureMode: "sas" | "sharedKey";
  sasUrl: string;
  accountName: string;
  accountKey: string;
  container: string;
  azurePrefix: string;
}

export interface EditableDestination {
  id: string;
  name: string;
  type: DestinationType;
  config: Record<string, unknown>;
}

export function emptyDestinationForm(type: DestinationType = "s3"): DestinationForm {
  return {
    type,
    name: "",
    endpoint: "",
    region: "us-east-1",
    bucket: "",
    s3Prefix: "polysiem/backups/",
    accessKeyId: "",
    secretAccessKey: "",
    forcePathStyle: false,
    azureMode: "sas",
    sasUrl: "",
    accountName: "",
    accountKey: "",
    container: "",
    azurePrefix: "polysiem/backups/",
  };
}

export function destinationFormForEdit(destination: EditableDestination): DestinationForm {
  const config = destination.config;
  return {
    ...emptyDestinationForm(destination.type),
    type: destination.type,
    name: destination.name,
    endpoint: (config.endpoint as string) ?? "",
    region: (config.region as string) ?? "us-east-1",
    bucket: (config.bucket as string) ?? "",
    s3Prefix: (config.prefix as string) ?? "",
    accessKeyId: (config.accessKeyId as string) ?? "",
    forcePathStyle: Boolean(config.forcePathStyle),
    azureMode: (config.mode as "sas" | "sharedKey") ?? "sas",
    accountName: (config.accountName as string) ?? "",
    container: (config.container as string) ?? "",
    azurePrefix: (config.prefix as string) ?? "",
  };
}

export function buildDestinationConfig(form: DestinationForm, isEdit: boolean): Record<string, unknown> {
  if (form.type === "s3") {
    const config: Record<string, unknown> = {
      endpoint: form.endpoint.trim(),
      region: form.region.trim(),
      bucket: form.bucket.trim(),
      prefix: form.s3Prefix.trim(),
      accessKeyId: form.accessKeyId.trim(),
      forcePathStyle: form.forcePathStyle,
    };
    if (!isEdit || form.secretAccessKey.trim()) config.secretAccessKey = form.secretAccessKey.trim();
    return config;
  }
  if (form.azureMode === "sas") {
    const config: Record<string, unknown> = { mode: "sas" };
    if (!isEdit || form.sasUrl.trim()) config.sasUrl = form.sasUrl.trim();
    return config;
  }
  const config: Record<string, unknown> = {
    mode: "sharedKey",
    accountName: form.accountName.trim(),
    container: form.container.trim(),
    prefix: form.azurePrefix.trim(),
  };
  if (!isEdit || form.accountKey.trim()) config.accountKey = form.accountKey.trim();
  return config;
}

export function destinationHasStoredSecret(form: DestinationForm, editable?: EditableDestination): boolean {
  if (form.type === "s3") return Boolean(editable?.config.hasSecretAccessKey);
  return form.azureMode === "sas"
    ? Boolean(editable?.config.hasSasUrl)
    : Boolean(editable?.config.hasAccountKey);
}
