import crypto from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SSO entry from the Vince Gabriele team portal. The portal mints a signed,
// short-lived token (HMAC over {iat,eid} with the shared CORP_SSO_SECRET).
// If it verifies, we set the same `fbu_auth` cookie the password login sets
// (its value is DASHBOARD_PASSWORD, which the middleware checks) and drop the
// user on /admin — no second password. Invalid/expired → the normal login.
const COOKIE_NAME = "fbu_auth";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const TOKEN_TTL_SEC = 90; // token must be fresh (single-click handoff)

export async function GET(req: Request) {
  const url = new URL(req.url);
  const loginRedirect = NextResponse.redirect(new URL("/login", url));

  const token = url.searchParams.get("token") || "";
  const secret = process.env.CORP_SSO_SECRET;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!secret || !password || !token.includes(".")) return loginRedirect;

  const [body, mac] = token.split(".");
  if (!body || !mac) return loginRedirect;

  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return loginRedirect;

  let payload: { iat?: number };
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return loginRedirect;
  }
  if (typeof payload.iat !== "number" || Date.now() / 1000 - payload.iat > TOKEN_TTL_SEC) {
    return loginRedirect;
  }

  const res = NextResponse.redirect(new URL("/admin", url));
  res.cookies.set({
    name: COOKIE_NAME,
    value: password,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
