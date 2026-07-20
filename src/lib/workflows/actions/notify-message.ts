import { z } from "zod";
import type { ActionDefinition } from "../registry";

const configSchema = z.object({
  webhookUrl: z.url(),
  message: z.string().min(1).max(10_000),
  username: z.string().max(128).optional(),
});

const NOTIFY_TIMEOUT_MS = 15_000;

/**
 * Payload for a chat-webhook notification. Slack incoming webhooks
 * (hooks.slack.com) want { text }; Discord-style webhooks want { content }
 * plus an optional { username } override. Pure and exported for unit tests.
 */
export function buildNotifyPayload(
  webhookUrl: string,
  message: string,
  username?: string,
): Record<string, string> {
  if (webhookUrl.includes("hooks.slack.com")) {
    return { text: message };
  }
  const name = username?.trim();
  return { content: message, ...(name ? { username: name } : {}) };
}

/**
 * notify.message — convenience wrapper around http.webhook for chat
 * notifications: POSTs the Discord-compatible {content, username?} JSON shape,
 * or {text} when the URL is a Slack incoming webhook. Non-2xx responses set
 * ok to "false" (branch on it); only network failures/timeouts throw.
 */
export const notifyMessage: ActionDefinition = {
  meta: {
    kind: "notify.message",
    title: "Send notification",
    description:
      "Posts a message to a Discord- or Slack-compatible webhook. The message is templateable, so run inputs and upstream outputs can be included.",
    category: "notify",
    inputs: [
      {
        key: "webhookUrl",
        label: "Webhook URL",
        type: "string",
        required: true,
        help: "Discord/Slack-compatible webhook URL",
        placeholder: "https://discord.com/api/webhooks/...",
      },
      {
        key: "message",
        label: "Message",
        type: "text",
        required: true,
        placeholder: "Allocated {{nodes.step1.ip}} for {{input.name}}",
      },
      {
        key: "username",
        label: "Username",
        type: "string",
        required: false,
        help: "Sender name override for Discord-style webhooks (ignored by Slack).",
      },
    ],
    outputs: [
      { key: "status", label: "HTTP status code" },
      { key: "ok", label: 'Success ("true"/"false")' },
    ],
  },
  configSchema,
  async run({ config }) {
    const { webhookUrl, message, username } = configSchema.parse(config);
    const payload = buildNotifyPayload(webhookUrl, message, username);

    let res: Response;
    try {
      res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new Error(`Notification webhook timed out after ${NOTIFY_TIMEOUT_MS / 1000}s — check that the endpoint responds`);
      }
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : null;
      const detail = cause ?? (err instanceof Error ? err.message : String(err));
      throw new Error(`Could not reach the notification webhook: ${detail}. Check the URL`);
    }
    // Drain the body so the connection is released; content is irrelevant here.
    await res.text().catch(() => "");
    return { status: res.status, ok: res.ok ? "true" : "false" };
  },
};
