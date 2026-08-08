import { NextResponse, type NextRequest } from "next/server";
import {
  isLockedDemoMode,
  isPublicDemoRequestAllowed,
} from "@/lib/demo/mode";

const PUBLIC_PATHS = [
  "/login",
  "/setup",
  "/opengraph-image",
  "/twitter-image",
];

function requestSecurityContext(request: NextRequest): {
  headers: Headers;
  contentSecurityPolicy: string;
} {
  const nonce = btoa(crypto.randomUUID());
  const scriptSources = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (process.env.NODE_ENV === "development") scriptSources.push("'unsafe-eval'");

  const contentSecurityPolicy = [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSources.join(" ")}`,
    "connect-src 'self'",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  // Next reads the request CSP/nonce when rendering framework and application
  // scripts. The response receives the same policy below.
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", contentSecurityPolicy);
  return { headers, contentSecurityPolicy };
}

function secured(response: NextResponse, contentSecurityPolicy: string): NextResponse {
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

/**
 * Coarse route protection only: checks for the presence of the session cookie
 * and redirects to /login. Real session validation and role checks happen
 * server-side in layouts, pages, and route handlers.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const security = requestSecurityContext(request);

  if (
    isLockedDemoMode() &&
    !isPublicDemoRequestAllowed(pathname, request.method)
  ) {
    return secured(
      NextResponse.json(
        {
          error: {
            code: "demo_read_only",
            message:
              "This public PolySIEM demo is read-only. Launch your own instance to save changes.",
          },
        },
        {
          status: 423,
          headers: { "Cache-Control": "no-store" },
        },
      ),
      security.contentSecurityPolicy,
    );
  }

  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.includes(".")
  ) {
    return secured(
      NextResponse.next({ request: { headers: security.headers } }),
      security.contentSecurityPolicy,
    );
  }

  const hasSession = request.cookies.has("polysiem_session");
  if (!hasSession) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return secured(NextResponse.redirect(login), security.contentSecurityPolicy);
  }

  return secured(
    NextResponse.next({ request: { headers: security.headers } }),
    security.contentSecurityPolicy,
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
