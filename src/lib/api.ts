import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Throwable API error carrying an HTTP status and machine-readable code. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/**
 * Wrap a route handler body: converts ApiError / ZodError / unknown errors
 * into the standard `{ error: { code, message } }` JSON shape.
 */
export function handleApi<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return jsonError(err.status, err.code, err.message);
      }
      if (err instanceof ZodError) {
        return jsonError(400, "validation_error", "Invalid request body", err.issues);
      }
      // next/navigation redirect() and notFound() rethrow
      if (err instanceof Error && "digest" in err && typeof err.digest === "string") {
        throw err;
      }
      console.error("Unhandled API error:", err);
      return jsonError(500, "internal_error", "An unexpected error occurred");
    }
  };
}
