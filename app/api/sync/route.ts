import { NextResponse } from "next/server";

// Daily cron trigger at midnight ET (4am UTC during EDT).
// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" automatically.
// Also accepts ?token=<SYNC_SECRET> for manual browser trigger.

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("token");
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const cronSecret = process.env.CRON_SECRET;
  const syncSecret = process.env.SYNC_SECRET;

  // Allow either: manual via ?token= OR Vercel Cron via Bearer
  const ok =
    (queryToken && syncSecret && queryToken === syncSecret) ||
    (bearerToken && cronSecret && bearerToken === cronSecret);

  if (!ok) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { syncAll } = await import("@/scripts/syncLib");
    const result = await syncAll();
    return NextResponse.json({ ts: new Date().toISOString(), ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 });
  }
}
