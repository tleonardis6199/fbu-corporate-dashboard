import { Card, SectionHeader } from "@/components/Card";
import { createServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function PurchasersPage() {
  const sb = createServerClient();
  // Distinct customers with at least one successful charge in the last 2 years
  const { data: charges } = await sb
    .from("stripe_charges")
    .select("customer_id, amount, created_at, description, stripe_customers(email, name, phone, address, metadata)")
    .eq("status", "succeeded")
    .gte("created_at", new Date(Date.now() - 2 * 365 * 86400000).toISOString())
    .order("created_at", { ascending: false });

  // Group by customer
  type Row = { customer: any; charges: any[]; total: number; last: string };
  const byCustomer = new Map<string, Row>();
  for (const c of ((charges as any[]) ?? []) as any[]) {
    if (!c.customer_id) continue;
    const cur: Row = byCustomer.get(c.customer_id) ?? {
      customer: c.stripe_customers,
      charges: [] as any[],
      total: 0,
      last: c.created_at,
    };
    cur.charges.push(c);
    cur.total += Number(c.amount ?? 0);
    byCustomer.set(c.customer_id, cur);
  }
  const rows = Array.from(byCustomer.values()).sort((a, b) => b.total - a.total);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-dim text-xs uppercase tracking-widest">Last 24 months</div>
        <h2 className="text-3xl font-bold tracking-tight">Past Purchasers</h2>
        <div className="text-sm text-muted mt-1">{rows.length} unique customers</div>
      </div>

      <SectionHeader accent="#22c55e" title="Purchaser List" count={rows.length} />
      <Card className="!p-0 overflow-x-auto">
        <div className="grid grid-cols-[1.3fr_1.5fr_1fr_1.5fr_auto_auto] gap-3 px-5 py-3 border-b border-border text-[11px] uppercase tracking-wide text-dim">
          <span>Name</span>
          <span>Email</span>
          <span>Phone</span>
          <span>Address</span>
          <span># Charges</span>
          <span className="text-right">Total</span>
        </div>
        {rows.length === 0 && <div className="p-5 text-dim text-sm">No purchaser data. Run sync.</div>}
        {rows.slice(0, 200).map((r, i) => {
          const addr = r.customer?.address;
          const addrStr = addr ? [addr.line1, addr.city, addr.state].filter(Boolean).join(", ") : "";
          return (
            <div
              key={i}
              className="grid grid-cols-[1.3fr_1.5fr_1fr_1.5fr_auto_auto] gap-3 px-5 py-3 items-center text-sm"
              style={{ borderBottom: i < rows.length - 1 ? "1px solid #1e293b" : undefined }}
            >
              <span className="font-medium">{r.customer?.name ?? "—"}</span>
              <a href={`mailto:${r.customer?.email}`} className="text-accent-kpi text-xs truncate">{r.customer?.email ?? "—"}</a>
              <span className="text-xs font-mono">{r.customer?.phone ?? <span className="text-dim">—</span>}</span>
              <span className="text-xs text-muted truncate">{addrStr || <span className="text-dim italic">—</span>}</span>
              <span className="text-xs text-muted">{r.charges.length}</span>
              <span className="text-right font-semibold">${r.total.toLocaleString()}</span>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
