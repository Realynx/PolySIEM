/**
 * Frame an AgentStreamEvent async generator as an SSE ReadableStream. Each
 * event is written as `data: <json>\n\n` per the contract. A terminal `error`
 * event is emitted if the generator throws mid-stream.
 */
import "server-only";
import { AGENT_SSE_CONTENT_TYPE, type AgentStreamEvent } from "@/lib/ai/agent/contract";

export const AGENT_SSE_HEADERS: Record<string, string> = {
  "Content-Type": AGENT_SSE_CONTENT_TYPE,
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

function frame(event: AgentStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * @param gen source events
 * @param onReport optional callback invoked with the terminal report (for persistence)
 */
export function sseStreamFromEvents(
  gen: AsyncGenerator<AgentStreamEvent, unknown>,
  onReport?: (report: Extract<AgentStreamEvent, { type: "report" }>["report"]) => void | Promise<void>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of gen) {
          if (event.type === "report" && onReport) {
            try {
              await onReport(event.report);
            } catch {
              // persistence failure must not break the stream
            }
          }
          controller.enqueue(encoder.encode(frame(event)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Agent run failed";
        controller.enqueue(encoder.encode(frame({ type: "error", message })));
      } finally {
        controller.close();
      }
    },
    async cancel() {
      await gen.return?.(undefined).catch(() => undefined);
    },
  });
}
