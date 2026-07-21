import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool as run } from "@/lib/mcp/tool-results";
import { listAiCredentials, readCredentialSecret } from "@/lib/services/ai-credentials";

const readOnly = { readOnlyHint: true } as const;

export function registerCredentialTools(server: McpServer): void {
  server.registerTool(
    "list_ai_credentials",
    {
      title: "List AI credentials",
      description:
        "Credentials the PolySIEM admin has explicitly shared with AI assistants: name, description, username, and URL — never the secret. Use this to discover what is available, then fetch one secret on demand with get_ai_credential.",
      annotations: readOnly,
    },
    async (extra) =>
      run("credentials", extra, async () => {
        const items = await listAiCredentials();
        return {
          credentials: items.map(({ name, description, username, url, updatedAt }) => ({
            name,
            description,
            username,
            url,
            updatedAt,
          })),
          total: items.length,
        };
      }),
  );

  server.registerTool(
    "get_ai_credential",
    {
      title: "Get AI credential",
      description:
        "Fetch ONE credential by name, including its decrypted secret. Every call is audit-logged. Fetch a secret on demand right before you need it and NEVER persist it — do not write it to files, documentation, code, chat summaries, or memory of any kind.",
      inputSchema: {
        name: z.string().min(1).max(64).describe("Credential name (see list_ai_credentials)"),
      },
    },
    async (args, extra) => run("credentials", extra, (actor) => readCredentialSecret(args.name, actor)),
  );
}
