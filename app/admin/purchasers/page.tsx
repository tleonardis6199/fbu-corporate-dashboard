import { Card, KPI, SectionHeader } from "@/components/Card";
import { createServerClient } from "@/lib/supabase";
import { loadMembersData } from "@/lib/members";
import { PROGRAM_COLOR, PROGRAM_LABEL, ProgramKey } from "@/lib/programs";
import { MemberTable } from "./MemberTable";

export const dynamic = "force-dynamic";

export default async function PurchasersPage() {
  const members = await loadMembersData();

  const sb = createServerClient();
  const cutoff = new Date(Date.now() - 2 * 365 * 86400000).toISOString();

  const [chargesRes, invoicesRes, subsRes] = await Promise.all([
    sb
      .from("stripe_charges")
      .select("customer_id, amount, created_at, description, invoice_id, stripe_customers(email, name, phone, address)")
      .eq("status", "succeeded")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false }),
    sb
      .from("stripe_invoices")
      .select("id, customer_id, subscription_id, lines")
      .eq("status", "paid")
      .gte("paid_at", cutoff),
    sb
      .from("stripe_subscriptions")
      .select("id, product_name"),
  ]);

  // Build invoice_id → product_name lookup (first line of invoice or subscription's product)
  const invoiceToProduct = new Map<string, string>();
  const subToProduct = new Map<string, string>();
  for (const s of (subsRes.data ?? []) as any[]) {
    if (s.id && s.product_name) subToProduct.set(s.id, s.product_name);
  }
  for (const inv of (invoicesRes.data ?? []) as any[]) {
    let prod: string | null = null;
    if (inv.subscription_id) prod = subToProduct.get(inv.subscription_id) ?? null;
    if (!prod && inv.lines?.data?.[0]?.description) {
      // Line desc is like "1 × Product Name (at $X / month)" — strip the prefix
      const raw = inv.lines.data[0].description as string;
      prod = raw.replace(/^\d+\s*×\s*/, "").replace(/\s*\(at.*$/, "").trim();
    }
    if (prod) invoiceToProduct.set(inv.id, prod);
  }

  type Row = { customer: any; charges: any[]; total: number; last: string; products: Map<string, number> };
  const byCustomer = new Map<string, Row>();
  for (const c of ((chargesRes.data as any[]) ?? []) as any[]) {
    if (!c.customer_id) continue;
    const cur: Row = byCustomer.get(c.customer_id) ?? {
      customer: c.stripe_customers,
      charges: [] as any[],
      total: 0,
      last: c.created_at,
      products: new Map<string, number>(),
    };
    cur.charges.push(c);
    cur.total += Number(c.amount ?? 0);
    // Figure out what was purchased
    let productLabel: string | null = null;
    if (c.invoice_id && invoiceToProduct.has(c.invoice_id)) {
      productLabel = invoiceToProduct.get(c.invoice_id)!;
    } else if (c.description) {
      productLabel = c.description as string;
    }
    if (productLabel) {
      cur.products.set(productLabel, (cur.products.get(productLabel) ?? 0) + 1);
    }
    byCustomer.set(c.customer_id, cur);
  }
  const rows = Array.from(byCustomer.values()).sort((a, b) => b.total - a.total);

  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const pct = (n: number) => `${n.toFixed(1)}%`;

  const programs: { cat: ProgramKey; emoji: string }[] = [
    { cat: "mastermind", emoji: "💼" },
    { cat: "elite", emoji: "⭐" },
    { cat: "ceo", emoji: "👑" },
    { cat: "nca", emoji: "🎓" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <div className="text-dim text-xs uppercase tracking-widest">Members + Purchasers</div>
        <h2 className="text-3xl font-bold tracking-tight">Active Members</h2>
        <div className="text-sm text-muted mt-1">
          Live from Stripe · history since 2020
        </div>
      </div>

      {/* KPI row 1: Active counts per program */}
      <div className="flex gap-3 flex-wrap">
        {programs.map(({ cat, emoji }) => (
          <KPI
            key={cat}
            label={`${emoji} Active ${PROGRAM_LABEL[cat]}`}
            value={members.stats[cat].activeCount}
            sub={`$${Math.round(members.stats[cat].mrr).toLocaleString()}/mo MRR`}
            color={PROGRAM_COLOR[cat]}
          />
        ))}
        <KPI
          label="⏸ On Hold"
          value={members.onHold.length}
          sub="paused subscriptions"
          color="#94a3b8"
        />
      </div>

      {/* KPI row 2: Attrition + LTV + Length */}
      <div className="flex gap-3 flex-wrap">
        <KPI
          label="Attrition MTD"
          value={pct(members.attritionMTD.rate)}
          sub={`${members.attritionMTD.canceled} canceled / ${members.attritionMTD.activeStart} active @ month start`}
          color={members.attritionMTD.rate > 5 ? "#ef4444" : members.attritionMTD.rate > 2 ? "#f97316" : "#22c55e"}
        />
        <KPI
          label="Attrition YTD avg"
          value={pct(members.attritionYTD.monthlyAvgRate)}
          sub={`${members.attritionYTD.canceled} total canceled YTD · ${Math.round(members.attritionYTD.avgActive)} avg active/mo`}
          color={members.attritionYTD.monthlyAvgRate > 5 ? "#ef4444" : members.attritionYTD.monthlyAvgRate > 2 ? "#f97316" : "#22c55e"}
        />
        <KPI
          label="Mastermind Avg LTV"
          value={money(members.stats.mastermind.avgLTV)}
          sub={`${Math.round(members.stats.mastermind.avgStayMonths)} mo avg stay · ${members.stats.mastermind.cohortSize} customers since 2020`}
          color={PROGRAM_COLOR.mastermind}
        />
        <KPI
          label="NCA Avg LTV"
          value={money(members.stats.nca.avgLTV)}
          sub={`${Math.round(members.stats.nca.avgStayMonths)} mo avg stay · ${members.stats.nca.cohortSize} customers since 2020`}
          color={PROGRAM_COLOR.nca}
        />
      </div>

      {/* Active member lists per program */}
      {programs.map(({ cat, emoji }) => {
        const rows = members.byCategory[cat];
        const alumni = members.alumniByCategory[cat];
        if (rows.length === 0 && alumni.length === 0) return null;
        return (
          <div key={cat} className="space-y-4">
            {rows.length > 0 && (
              <div>
                <SectionHeader
                  accent={PROGRAM_COLOR[cat]}
                  title={`${emoji} Active ${PROGRAM_LABEL[cat]}`}
                  count={rows.length}
                  subtitle={`$${Math.round(members.stats[cat].mrr).toLocaleString()}/mo MRR · avg LTV ${money(members.stats[cat].avgLTV)} · avg stay ${Math.round(members.stats[cat].avgStayMonths)}mo · ${members.stats[cat].cohortSize} all-time`}
                />
                <MemberTable rows={rows} />
              </div>
            )}
            {alumni.length > 0 && (
              <details className="bg-card border border-border rounded-xl">
                <summary className="px-5 py-3 cursor-pointer text-muted hover:text-text text-sm">
                  📦 {PROGRAM_LABEL[cat]} Alumni ({alumni.length}) — last payment &gt;12 months ago
                </summary>
                <MemberTable rows={alumni} showLastPaid />
              </details>
            )}
          </div>
        );
      })}

      {/* On-hold */}
      {members.onHold.length > 0 && (
        <div>
          <SectionHeader accent="#94a3b8" title="⏸ On Hold (Paused)" count={members.onHold.length} />
          <MemberTable rows={members.onHold} />
        </div>
      )}

      {/* Terminations */}
      {members.terminatedMTD.length > 0 && (
        <div>
          <SectionHeader
            accent="#ef4444"
            title="❌ Terminated MTD"
            count={members.terminatedMTD.length}
            subtitle="Subscriptions canceled this month"
          />
          <MemberTable rows={members.terminatedMTD} showCanceledAt />
        </div>
      )}

      {members.terminatedYTD.length > members.terminatedMTD.length && (
        <details className="bg-card border border-border rounded-xl">
          <summary className="px-5 py-3 cursor-pointer text-muted hover:text-text text-sm">
            📋 All Terminations YTD ({members.terminatedYTD.length})
          </summary>
          <MemberTable rows={members.terminatedYTD} showCanceledAt />
        </details>
      )}

      {/* Active in Stripe but not in master list — review candidates */}
      {members.unmatchedStripeActive.length > 0 && (
        <details className="bg-card border border-dashed border-border rounded-xl">
          <summary className="px-5 py-3 cursor-pointer text-muted hover:text-text text-sm">
            🔍 Active in Stripe but not in Master List ({members.unmatchedStripeActive.length}) — may need categorization
          </summary>
          <div className="border-t border-border">
            {members.unmatchedStripeActive.map((u, i) => (
              <div
                key={i}
                className="grid grid-cols-[1.5fr_1.5fr_1.5fr_auto] gap-3 px-5 py-2 text-sm"
                style={{ borderBottom: i < members.unmatchedStripeActive.length - 1 ? "1px solid #1e293b" : undefined }}
              >
                <span>{u.name ?? "—"}</span>
                <a href={`mailto:${u.email}`} className="text-accent-kpi text-xs truncate">{u.email ?? "—"}</a>
                <span className="text-xs text-muted truncate">{u.product ?? "—"}</span>
                <span className="text-right">${u.mrr.toLocaleString()}/mo</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Past purchasers list (all 2y buyers) */}
      <div>
        <SectionHeader accent="#22c55e" title="All Purchasers (L24M)" count={rows.length} subtitle="Everyone who paid in the last 24 months, sorted by total" />
        <Card className="!p-0 overflow-x-auto">
          <div className="grid grid-cols-[1.3fr_1.5fr_1fr_2fr_auto_auto] gap-3 px-5 py-3 border-b border-border text-[11px] uppercase tracking-wide text-dim">
            <span>Name</span>
            <span>Email / Address</span>
            <span>Phone</span>
            <span>Products Purchased</span>
            <span># Charges</span>
            <span className="text-right">Total</span>
          </div>
          {rows.slice(0, 300).map((r, i) => {
            const addr = r.customer?.address;
            const addrStr = addr ? [addr.line1, addr.city, addr.state].filter(Boolean).join(", ") : "";
            const products = Array.from(r.products.entries())
              .sort((a, b) => b[1] - a[1]);
            return (
              <div
                key={i}
                className="grid grid-cols-[1.3fr_1.5fr_1fr_2fr_auto_auto] gap-3 px-5 py-3 items-start text-sm"
                style={{ borderBottom: i < rows.length - 1 ? "1px solid #1e293b" : undefined }}
              >
                <span className="font-medium">{r.customer?.name ?? "—"}</span>
                <div className="text-xs truncate">
                  <a href={`mailto:${r.customer?.email}`} className="text-accent-kpi block truncate">{r.customer?.email ?? "—"}</a>
                  {addrStr && <div className="text-dim text-[11px] mt-0.5 truncate">{addrStr}</div>}
                </div>
                <span className="text-xs font-mono">{r.customer?.phone ?? <span className="text-dim">—</span>}</span>
                <div className="text-xs space-y-0.5">
                  {products.length === 0 ? (
                    <span className="text-dim italic">—</span>
                  ) : (
                    products.slice(0, 5).map(([name, count]) => (
                      <div key={name} className="text-text">
                        {name}
                        {count > 1 && <span className="text-dim ml-1">×{count}</span>}
                      </div>
                    ))
                  )}
                  {products.length > 5 && <div className="text-dim">+{products.length - 5} more</div>}
                </div>
                <span className="text-xs text-muted">{r.charges.length}</span>
                <span className="text-right font-semibold">${r.total.toLocaleString()}</span>
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}
