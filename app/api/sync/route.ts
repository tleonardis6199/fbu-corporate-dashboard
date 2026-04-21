import { NextResponse } from "next/server";

// Vercel Cron trigger endpoint. Protected by SYNC_SECRET query param.
// Calls the sync script via child_process (works on Vercel Node runtime).
// For large syncs, this can exceed Vercel function timeout — in that case
// prefer running the sync locally with `npm run sync` weekly.

export const runtime = "nodejs";
export const maxDuration = 300; // 5 min (Pro plan)

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (token !== process.env.SYNC_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Dynamic import so the bundler doesn't try to include Stripe SDK in edge
  try {
    const { syncAll } = await import("@/scripts/syncLib");
    await syncAll();
    return NextResponse.json({ ok: true, ts: new Date().toISOString() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
