import { z } from "zod";

/** Body for POST /api/admin/web-certificate/generate. */
export const generateWebCertificateSchema = z.object({
  commonName: z.string().trim().max(64).optional(),
  altNames: z
    .array(z.string().trim().min(1).max(253))
    .max(50)
    .optional(),
  days: z.number().int().min(1).max(7300).optional(),
});

/** Body for PUT /api/admin/web-certificate (PEM upload). */
export const uploadWebCertificateSchema = z.object({
  certPem: z.string().min(1).max(131072),
  keyPem: z.string().min(1).max(131072),
});

export type GenerateWebCertificateInput = z.infer<typeof generateWebCertificateSchema>;
export type UploadWebCertificateInput = z.infer<typeof uploadWebCertificateSchema>;
