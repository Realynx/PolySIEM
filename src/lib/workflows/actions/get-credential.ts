import { z } from "zod";
import { readCredentialSecret } from "@/lib/services/ai-credentials";
import type { ActionDefinition } from "../registry";

const configSchema = z.object({
  name: z.string().min(1).max(255),
});

/**
 * credentials.get — fetch a credential from the AI credential store by name,
 * typically to feed an Authorization header of a downstream HTTP request.
 * Reuses readCredentialSecret, so every read writes an ai_credential.read
 * audit row (name only, never the value). The secret output is marked
 * secret: true — the engine redacts it from persisted step output and returns
 * it only once in the run response; downstream nodes reference it as
 * {{nodes.<id>.secret}}, which stays a template in the stored graph.
 */
export const credentialsGet: ActionDefinition = {
  meta: {
    kind: "credentials.get",
    title: "Get AI credential",
    description:
      "Reads a credential from the AI credential store (Security → AI credentials). The read is audited; the secret is redacted from run history and only flows to downstream nodes via templates.",
    category: "http",
    inputs: [
      {
        key: "name",
        label: "Credential name",
        type: "string",
        required: true,
        help: "Name of the stored credential (templateable).",
      },
    ],
    outputs: [
      { key: "username", label: "Username" },
      { key: "url", label: "URL" },
      { key: "secret", label: "Secret", secret: true },
    ],
  },
  configSchema,
  async run({ config, ctx }) {
    const { name } = configSchema.parse(config);
    const credential = await readCredentialSecret(name, ctx.actor);
    return {
      username: credential.username ?? "",
      url: credential.url ?? "",
      secret: credential.secret,
    };
  },
};
