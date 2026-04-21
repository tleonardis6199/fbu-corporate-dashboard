import { NextResponse } from "next/server";

const COOKIE_NAME = "fbu_auth";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function POST(req: Request) {
  const { password } = await req.json();
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  if (password !== expected) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
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
