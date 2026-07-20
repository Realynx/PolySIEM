import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // node-forge must stay a real package in the standalone node_modules: the
  // TLS entrypoint (server/tls-server.js) requires it outside the compiled
  // bundle. undici must stay external because webpack cannot bundle its
  // node:-scheme internals (imported by the dev-warmup HTTPS dispatcher).
  serverExternalPackages: ["node-forge", "undici"],
  experimental: {
    // Parallel workers can race while merging the app-path manifest on Windows,
    // leaving valid routes out of standalone release builds.
    cpus: 1,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            // Self-hosted, fully self-contained app. Allow inline styles/scripts
            // (Next injects some) but block framing and third-party origins.
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "img-src 'self' data: blob:",
              "style-src 'self' 'unsafe-inline'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "connect-src 'self'",
              "font-src 'self' data:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
