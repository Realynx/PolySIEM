import type { MetadataRoute } from "next";

/** Web app manifest — makes PolySIEM installable on mobile and desktop. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PolySIEM",
    short_name: "PolySIEM",
    description: "Self-hosted homelab documentation dashboard",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#2563eb",
    icons: [
      { src: "/brand/polysiem-mark.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
