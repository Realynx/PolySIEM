import { z } from "zod";

/**
 * Zod schemas for the backup API. Config secrets (S3 secretAccessKey, Azure
 * accountKey / sasUrl) are optional on update so an existing secret can be kept
 * without re-entering it; the service treats an omitted/blank secret as "leave
 * unchanged".
 */

const httpUrl = (v: string) => v.startsWith("http://") || v.startsWith("https://");

/* ---------- S3 ---------- */

const s3ConfigBase = {
  endpoint: z.string().min(1).max(512).refine(httpUrl, "Endpoint must be an http(s):// URL"),
  region: z.string().min(1).max(64),
  bucket: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^/]+$/, "Bucket name must not contain a slash"),
  prefix: z.string().max(512).default(""),
  accessKeyId: z.string().min(1).max(256),
  forcePathStyle: z.boolean().default(false),
};

const s3ConfigCreateSchema = z.object({
  ...s3ConfigBase,
  secretAccessKey: z.string().min(1, "Secret access key is required").max(1024),
});

const s3ConfigUpdateSchema = z.object({
  endpoint: s3ConfigBase.endpoint.optional(),
  region: z.string().min(1).max(64).optional(),
  bucket: s3ConfigBase.bucket.optional(),
  prefix: z.string().max(512).optional(),
  accessKeyId: z.string().min(1).max(256).optional(),
  forcePathStyle: z.boolean().optional(),
  secretAccessKey: z.string().max(1024).optional(),
});

/* ---------- Azure ---------- */

const azureConfigBase = {
  mode: z.enum(["sas", "sharedKey"]),
  sasUrl: z.string().max(2048).optional(),
  accountName: z.string().max(256).optional(),
  accountKey: z.string().max(1024).optional(),
  container: z.string().max(256).optional(),
  prefix: z.string().max(512).optional(),
};

const requireAzureMode = (
  v: { mode: string; sasUrl?: string; accountName?: string; accountKey?: string; container?: string },
  ctx: z.RefinementCtx,
  requireSecrets: boolean,
) => {
  if (v.mode === "sas") {
    if (requireSecrets && !v.sasUrl?.trim()) {
      ctx.addIssue({ code: "custom", message: "A container SAS URL is required", path: ["sasUrl"] });
    }
    if (v.sasUrl && !httpUrl(v.sasUrl)) {
      ctx.addIssue({ code: "custom", message: "SAS URL must be an https:// URL", path: ["sasUrl"] });
    }
  } else {
    if (!v.accountName?.trim())
      ctx.addIssue({ code: "custom", message: "Account name is required", path: ["accountName"] });
    if (!v.container?.trim())
      ctx.addIssue({ code: "custom", message: "Container is required", path: ["container"] });
    if (requireSecrets && !v.accountKey?.trim())
      ctx.addIssue({ code: "custom", message: "Account key is required", path: ["accountKey"] });
  }
};

const azureConfigCreateSchema = z
  .object(azureConfigBase)
  .superRefine((v, ctx) => requireAzureMode(v, ctx, true));

const azureConfigUpdateSchema = z
  .object(azureConfigBase)
  .superRefine((v, ctx) => requireAzureMode(v, ctx, false));

/* ---------- destinations ---------- */

const destinationName = z.string().min(1, "Name is required").max(64);

export const createDestinationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("s3"), name: destinationName, config: s3ConfigCreateSchema }),
  z.object({ type: z.literal("azure"), name: destinationName, config: azureConfigCreateSchema }),
]);
export type CreateDestinationInput = z.infer<typeof createDestinationSchema>;

/**
 * Update: the destination type is immutable, so config is validated against the
 * stored type in the service. The route-level schema stays loose here (secrets
 * optional) — see s3ConfigUpdateSchema / azureConfigUpdateSchema.
 */
export const updateDestinationSchema = z.object({
  name: destinationName.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateDestinationInput = z.infer<typeof updateDestinationSchema>;

export { s3ConfigUpdateSchema, azureConfigUpdateSchema };

/* ---------- config ---------- */

export const backupConfigSchema = z.object({
  schedule: z.enum(["off", "daily", "weekly"]),
  destinationId: z.string().max(64).default(""),
  retention: z.number().int().min(0).max(365).default(0),
});
export type BackupConfigInput = z.infer<typeof backupConfigSchema>;
