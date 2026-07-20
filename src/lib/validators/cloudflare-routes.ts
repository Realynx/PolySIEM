import { z } from "zod";

const hostname = z.string().trim().toLowerCase().min(1).max(253).regex(
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  "Enter a complete DNS hostname, such as app.example.com",
);

const originService = z.string().trim().min(1).max(2048).refine(
  (value) => /^(?:https?|tcp|ssh|rdp|smb|unix|unix\+tls):\/\//i.test(value),
  "Use a supported origin such as http://10.0.3.20:8080",
);

export const cloudflarePublishedRouteSchema = z.object({
  tunnelId: z.uuid(),
  zoneId: z.string().regex(/^[a-f0-9]{32}$/i),
  hostname,
  service: originService,
  path: z.string().trim().max(2048).optional().default(""),
});

export const deleteCloudflarePublishedRouteSchema = z.object({
  tunnelId: z.uuid(),
  zoneId: z.string().regex(/^[a-f0-9]{32}$/i),
  hostname,
});

export type CloudflarePublishedRouteInput = z.infer<typeof cloudflarePublishedRouteSchema>;
export type DeleteCloudflarePublishedRouteInput = z.infer<typeof deleteCloudflarePublishedRouteSchema>;
