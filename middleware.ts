import { NextRequest, NextResponse } from "next/server";

// Simple cookie-based password gate for /admin/* routes.
// Cookie stores the password itself (HTTP-only, so JS can't read it).
// This is fine for an internal single-tenant dashboard behind HTTPS.

const COOKIE_NAME = "fbu_auth";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  const cookieValue = req.cookies.get(COOKIE_NAME)?.value;
  const expected = process.env.DASHBOARD_PASSWORD;

  if (!cookieValue || !expected || cookieValue !== expected) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
