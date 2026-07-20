import { ApiError } from "@/lib/api";
import { mockGenerate, mockGenerateJson, MOCK_MODELS } from "@/lib/ai/mock";

export interface GenerateStreamOptions {
  baseUrl: string;
  model: string;
  prompt: string;
  system?: string;
  signal?: AbortSignal;
}

const GENERATE_TIMEOUT_MS = 60_000;
const JSON_TIMEOUT_MS = 120_000;
const TAGS_TIMEOUT_MS = 10_000;

/** Mock mode: canned streaming responses, no real Ollama required. */
export function isMockMode(baseUrl: string): boolean {
  return baseUrl.startsWith("mock://") || process.env.MOCK_AI === "true";
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function mapFetchError(err: unknown, baseUrl: string): ApiError {
  if (err instanceof ApiError) return err;
  if (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  ) {
    return new ApiError(
      504,
      "ollama_timeout",
      "The Ollama request timed out after 60 seconds.",
    );
  }
  return new ApiError(
    502,
    "ollama_unreachable",
    `Could not reach Ollama at ${baseUrl}. Check that Ollama is running and that the base URL in Settings is correct.`,
  );
}

/** Read Ollama's NDJSON /api/generate stream, yielding response tokens until done:true. */
async function* parseGenerateNdjson(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (line: string): { token?: string; done: boolean } => {
    let chunk: { response?: string; done?: boolean; error?: string };
    try {
      chunk = JSON.parse(line);
    } catch {
      throw new ApiError(
        502,
        "ollama_error",
        "Ollama returned malformed streaming JSON.",
      );
    }
    if (chunk.error) throw new ApiError(502, "ollama_error", chunk.error);
    return { token: chunk.response, done: chunk.done === true };
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const parsed = handleLine(line);
        if (parsed.token) yield parsed.token;
        if (parsed.done) return;
      }
    }
    const rest = (buffer + decoder.decode()).trim();
    if (rest) {
      const parsed = handleLine(rest);
      if (parsed.token) yield parsed.token;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

function generatorToStream(
  gen: AsyncGenerator<string>,
): ReadableStream<string> {
  return new ReadableStream<string>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await gen.return(undefined).catch(() => undefined);
    },
  });
}

/**
 * Provider-aware text generation. Both `generateStream` and `generateJson`
 * short-circuit mock mode first, then delegate hosted providers to provider.ts.
 * The provider module is imported lazily so the pure Ollama parsing helpers
 * stay importable without pulling hosted SDKs or settings into unit tests.
 */
async function resolveHostedText() {
  const provider = await import("./provider");
  const runtime = await provider.getActiveHostedText();
  return runtime ? { provider, runtime } : null;
}

/**
 * Stream a completion from the active backend as a ReadableStream of text
 * chunks. Ollama uses /api/generate; hosted providers use their native
 * LangChain integrations. Every path is bounded by a 60s overall timeout.
 */
export async function generateStream(
  options: GenerateStreamOptions,
): Promise<ReadableStream<string>> {
  const { baseUrl, model, prompt, system, signal } = options;
  const timeout = AbortSignal.timeout(GENERATE_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  if (isMockMode(baseUrl)) {
    return generatorToStream(mockGenerate(prompt, combined));
  }

  const hosted = await resolveHostedText();
  if (hosted) {
    return hosted.provider.hostedGenerateStream(hosted.runtime, {
      baseUrl,
      model,
      prompt,
      system,
      signal: combined,
    });
  }

  let res: Response;
  try {
    res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        ...(system ? { system } : {}),
        think: false,
        stream: true,
      }),
      signal: combined,
    });
  } catch (err) {
    throw mapFetchError(err, baseUrl);
  }

  if (!res.ok) {
    let message = `Ollama returned HTTP ${res.status}.`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // keep the HTTP status message
    }
    throw new ApiError(502, "ollama_error", message);
  }
  if (!res.body) {
    throw new ApiError(
      502,
      "ollama_error",
      "Ollama returned an empty response body.",
    );
  }
  return generatorToStream(parseGenerateNdjson(res.body));
}

/**
 * Non-streaming completion with Ollama's JSON mode (format:"json") — used by
 * the log scanner, which needs a whole structured document rather than tokens.
 * 120s timeout: small local models are slow on long analytical prompts.
 */
export async function generateJson(
  options: GenerateStreamOptions,
): Promise<string> {
  const { baseUrl, model, prompt, system, signal } = options;
  const timeout = AbortSignal.timeout(JSON_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  if (isMockMode(baseUrl)) {
    return mockGenerateJson(prompt);
  }

  const hosted = await resolveHostedText();
  if (hosted) {
    return hosted.provider.hostedGenerateJson(hosted.runtime, {
      baseUrl,
      model,
      prompt,
      system,
      signal: combined,
    });
  }

  let res: Response;
  try {
    res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        ...(system ? { system } : {}),
        think: false,
        format: "json",
        stream: false,
      }),
      signal: combined,
    });
  } catch (err) {
    throw mapFetchError(err, baseUrl);
  }

  if (!res.ok) {
    let message = `Ollama returned HTTP ${res.status}.`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // keep the HTTP status message
    }
    throw new ApiError(502, "ollama_error", message);
  }
  const body = (await res.json().catch(() => null)) as {
    response?: string;
    error?: string;
  } | null;
  if (body?.error) throw new ApiError(502, "ollama_error", body.error);
  if (typeof body?.response !== "string" || !body.response.trim()) {
    throw new ApiError(
      502,
      "ollama_error",
      "Ollama returned an empty response.",
    );
  }
  return body.response;
}

/** List available model names via Ollama's /api/tags. */
export async function listModels(baseUrl: string): Promise<string[]> {
  if (isMockMode(baseUrl)) return [...MOCK_MODELS];

  let res: Response;
  try {
    res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/tags`, {
      signal: AbortSignal.timeout(TAGS_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    throw mapFetchError(err, baseUrl);
  }

  if (!res.ok) {
    throw new ApiError(
      502,
      "ollama_error",
      `Ollama returned HTTP ${res.status} when listing models.`,
    );
  }
  const body = (await res.json()) as { models?: Array<{ name?: string }> };
  return (body.models ?? [])
    .map((m) => m.name)
    .filter((n): n is string => typeof n === "string");
}
