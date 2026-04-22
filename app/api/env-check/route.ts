import { NextResponse } from "next/server";

// Diagnostic endpoint — shows which env vars are populated at runtime
// WITHOUT exposing values. Safe to leave public.

export const runtime = "nodejs";

export async function GET() {
  const check = (name: string) => {
    const v = process.env[name];
    return {
      set: Boolean(v),
      length: v?.length ?? 0,
      first4: v ? v.slice(0, 4) : null,
      last4: v ? v.slice(-4) : null,
    };
  };

  return NextResponse.json({
    NEXT_PUBLIC_SUPABASE_URL: check("NEXT_PUBLIC_SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: check("SUPABASE_SERVICE_ROLE_KEY"),
    STRIPE_SECRET_KEY: check("STRIPE_SECRET_KEY"),
    GHL_PRIVATE_TOKEN: check("GHL_PRIVATE_TOKEN"),
    GHL_LOCATION_ID: check("GHL_LOCATION_ID"),
    GOOGLE_SHEETS_API_KEY: check("GOOGLE_SHEETS_API_KEY"),
    DASHBOARD_PASSWORD: check("DASHBOARD_PASSWORD"),
    SYNC_SECRET: check("SYNC_SECRET"),
    CRON_SECRET: check("CRON_SECRET"),
    NODE_ENV: process.env.NODE_ENV,
  });
}
