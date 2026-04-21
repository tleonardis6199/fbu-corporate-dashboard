import { Card, KPI, SectionHeader } from "@/components/Card";
import { createServerClient } from "@/lib/supabase";
import { loadMembersData } from "@/lib/members";
import { PROGRAM_COLOR, PROGRAM_LABEL, ProgramCategory } from "@/lib/programs";
import { MemberTable } from "./MemberTable";

export const dynamic = "force-dynamic";

export default async function PurchasersPage() {
  const members = await loadMembersData();

  const sb = createServerClient();
  const { data: charges } = await sb
    .from("stripe_charges")
    .select("customer_id, amount, created_at, stripe_customers(email, name, phone, address)")
    .eq("status", "succeeded")
    .gte("created_at", new Date(Date.now() - 2 * 365 * 86400000).toISOString())
    .order("created_at", { ascending: false });

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

  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const pct = (n: number) => `${n.toFixed(1)}%`;

  const programs: { cat: ProgramCategory; emoji: string }[] = [
    { cat: "mastermind", emoji: "💼" },
    { cat: "elite", emoji: "⭐" },
    { cat: "ceo", emoji: "👑" },
    { cat: "nca", emoji: "🎓" },
    { cat: "branding", emoji: "🎨" },
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
        if (rows.length === 0) return null;
        return (
          <div key={cat}>
            <SectionHeader
              accent={PROGRAM_COLOR[cat]}
              title={`${emoji} Active ${PROGRAM_LABEL[cat]}`}
              count={rows.length}
              subtitle={`$${Math.round(members.stats[cat].mrr).toLocaleString()}/mo MRR · avg LTV ${money(members.stats[cat].avgLTV)} · avg stay ${Math.round(members.stats[cat].avgStayMonths)}mo`}
            />
            <MemberTable rows={rows} />
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

      {/* Past purchasers list (all 2y buyers) */}
      <div>
        <SectionHeader accent="#22c55e" title="All Purchasers (L24M)" count={rows.length} subtitle="Everyone who paid in the last 24 months, sorted by total" />
        <Card className="!p-0 overflow-x-auto">
          <div className="grid grid-cols-[1.3fr_1.5fr_1fr_1.5fr_auto_auto] gap-3 px-5 py-3 border-b border-border text-[11px] uppercase tracking-wide text-dim">
            <span>Name</span>
            <span>Email</span>
            <span>Phone</span>
            <span>Address</span>
            <span># Charges</span>
            <span className="text-right">Total</span>
          </div>
          {rows.slice(0, 300).map((r, i) => {
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
    </div>
  );
}
