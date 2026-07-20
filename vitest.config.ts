import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  oxc: {
    // Next keeps JSX for its own compiler; Vitest must lower TSX before Vite's
    // import-analysis pass when a .ts test imports a client component.
    jsx: { runtime: "automatic" },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // "server-only" throws outside a React Server environment; stub it for unit tests.
      "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
});
