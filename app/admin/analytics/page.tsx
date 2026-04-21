import { Card, SectionHeader } from "@/components/Card";
import { createServerClient } from "@/lib/supabase";
import { AnalyticsDashboard } from "./AnalyticsDashboard";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const sb = createServerClient();

  // Pull paid invoices + subscriptions for time-series analytics
  // We aggregate client-side — Supabase free tier handles this fine for our volume.
  const { data: invoices } = await sb
    .from("stripe_invoices")
    .select("amount_paid, paid_at, subscription_id")
    .eq("status", "paid")
    .gte("paid_at", new Date("2020-01-01").toISOString())
    .order("paid_at", { ascending: true });

  const { data: subs } = await sb
    .from("stripe_subscriptions")
    .select("id, product_name, customer_id, status, created_at, canceled_at, unit_amount");

  return (
    <div className="space-y-6">
      <div>
        <div className="text-dim text-xs uppercase tracking-widest">Historical</div>
        <h2 className="text-3xl font-bold tracking-tight">Analytics</h2>
        <div className="text-sm text-muted mt-1">
          Year / quarter / month comparisons · LTV · attrition · since 2020
        </div>
      </div>

      <AnalyticsDashboard
        invoices={invoices ?? []}
        subscriptions={subs ?? []}
      />
    </div>
  );
}
