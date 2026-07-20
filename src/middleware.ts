import { NextResponse, type NextRequest } from "next/server";
import {
  isLockedDemoMode,
  isPublicDemoRequestAllowed,
} from "@/lib/demo/mode";

const PUBLIC_PATHS = ["/login", "/setup"];

/**
 * Coarse route protection only: checks for the presence of the session cookie
 * and redirects to /login. Real session validation and role checks happen
 * server-side in layouts, pages, and route handlers.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    isLockedDemoMode() &&
    !isPublicDemoRequestAllowed(pathname, request.method)
  ) {
    return NextResponse.json(
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
    );
  }

  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has("polysiem_session");
  if (!hasSession) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
