import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function daysAgo(d: number) {
  return new Date(Date.now() - d * 86400000).toISOString();
}

export async function GET() {
  const sb = createServerClient();

  const [lapsedAll, calls, flags] = await Promise.all([
    sb
      .from("stripe_subscriptions")
      .select("canceled_at, cancellation_reason, product_name, unit_amount, interval, stripe_customers(email, name, phone, address, metadata)")
      .eq("status", "canceled")
      .gte("canceled_at", daysAgo(60))
      .order("canceled_at", { ascending: false }),
    sb
      .from("sheet_call_status")
      .select("*")
      .gte("call_date", daysAgo(30).slice(0, 10))
      .order("call_date", { ascending: false }),
    sb.from("user_flags").select("*"),
  ]);

  const mapLapsed = (rows: any[] | null) =>
    (rows ?? []).map((s) => ({
      email: s.stripe_customers?.email,
      name: s.stripe_customers?.name,
      phone: s.stripe_customers?.phone,
      date: s.canceled_at ? s.canceled_at.slice(0, 10) : null,
      context: `${s.product_name ?? ""} · $${Number(s.unit_amount ?? 0)}/${s.interval === "week" ? "wk" : "mo"}`,
      amount: Number(s.unit_amount ?? 0),
      isMastermind: /mastermind/i.test(s.product_name ?? ""),
    }));

  const lapsed60Raw = lapsedAll.data ?? [];
  const lapsed30Raw = lapsed60Raw.filter((s: any) => s.canceled_at && s.canceled_at > daysAgo(30));

  const mapCalls = (filter: string) =>
    (calls.data ?? [])
      .filter((c: any) => c.status === filter)
      .map((c: any) => ({
        email: c.email,
        name: c.name,
        phone: null,
        date: c.call_date,
        context: `${c.call_type} ${filter.toLowerCase()}`,
      }));

  const flagMap: Record<string, any> = {};
  for (const f of flags.data ?? []) {
    flagMap[f.email] = f;
  }

  return NextResponse.json({
    data: {
      lapsed30: mapLapsed(lapsed30Raw),
      lapsed60: mapLapsed(lapsed60Raw),
      noshow: mapCalls("No Show"),
      cancelled: mapCalls("Cancelled"),
      rescheduled: mapCalls("Rescheduled"),
    },
    flags: flagMap,
  });
}
