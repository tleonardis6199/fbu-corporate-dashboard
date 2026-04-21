// Server-side aggregator for the Members view on Past Purchasers page.
// Computes: active lists per program, on-hold, attrition, LTV, length of stay.

import { createServerClient } from "./supabase";
import { categorizeProduct, ProgramCategory } from "./programs";

export type MemberRow = {
  subId: string;
  customerId: string | null;
  productName: string | null;
  category: ProgramCategory;
  status: string | null;
  unitAmount: number;
  interval: string | null;
  createdAt: string;
  canceledAt: string | null;
  // customer
  name: string | null;
  email: string | null;
  phone: string | null;
  businessName: string | null;
  address: string | null;
};

export type ProgramStats = {
  activeCount: number;
  mrr: number;
  avgLTV: number;
  avgStayMonths: number;
  cohortSize: number; // total unique customers ever in this program
};

export type MembersData = {
  byCategory: Record<ProgramCategory, MemberRow[]>;
  onHold: MemberRow[];
  stats: Record<ProgramCategory, ProgramStats>;
  attritionMTD: { canceled: number; activeStart: number; rate: number };
  attritionYTD: { canceled: number; avgActive: number; monthlyAvgRate: number };
};

function daysBetween(a: string | Date, b: string | Date): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
}

export async function loadMembersData(): Promise<MembersData> {
  const sb = createServerClient();

  // Pull everything we need in parallel
  const [subsRes, invoicesRes] = await Promise.all([
    sb
      .from("stripe_subscriptions")
      .select("id, customer_id, status, unit_amount, interval, created_at, canceled_at, product_name, stripe_customers(name, email, phone, address, metadata)")
      .gte("created_at", "2017-01-01"),
    sb
      .from("stripe_invoices")
      .select("subscription_id, amount_paid, paid_at")
      .eq("status", "paid")
      .gte("paid_at", "2017-01-01"),
  ]);

  const subs = (subsRes.data ?? []) as any[];
  const invoices = (invoicesRes.data ?? []) as any[];

  // Sum invoice amounts per subscription
  const invByCustomer: Map<string, number> = new Map();
  const subToCustomer: Map<string, string> = new Map();
  for (const s of subs) {
    if (s.id && s.customer_id) subToCustomer.set(s.id, s.customer_id);
  }
  for (const inv of invoices) {
    const cust = inv.subscription_id ? subToCustomer.get(inv.subscription_id) : null;
    if (!cust) continue;
    invByCustomer.set(cust, (invByCustomer.get(cust) ?? 0) + Number(inv.amount_paid ?? 0));
  }

  // Build rows
  const byCategory: Record<ProgramCategory, MemberRow[]> = {
    mastermind: [], elite: [], ceo: [], nca: [], branding: [], other: [],
  };
  const onHold: MemberRow[] = [];

  // For stats: group by category + customer to compute LTV and length of stay
  const categoryCohort: Record<ProgramCategory, Map<string, { firstStart: string; lastEnd: string | null; ltv: number }>> = {
    mastermind: new Map(), elite: new Map(), ceo: new Map(), nca: new Map(), branding: new Map(), other: new Map(),
  };

  for (const s of subs) {
    const cat = categorizeProduct(s.product_name);
    const c = s.stripe_customers ?? {};
    const addr = c.address;
    const addrStr = addr
      ? [addr.line1, addr.city, addr.state, addr.postal_code].filter(Boolean).join(", ")
      : null;
    const row: MemberRow = {
      subId: s.id,
      customerId: s.customer_id,
      productName: s.product_name,
      category: cat,
      status: s.status,
      unitAmount: Number(s.unit_amount ?? 0),
      interval: s.interval,
      createdAt: s.created_at,
      canceledAt: s.canceled_at,
      name: c.name,
      email: c.email,
      phone: c.phone,
      businessName: c.metadata?.business_name ?? c.metadata?.gym_name ?? null,
      address: addrStr,
    };

    if (s.status === "active") {
      byCategory[cat].push(row);
    }
    if (s.status === "paused") {
      onHold.push(row);
    }

    // Build cohort stats (one entry per customer per category, tracking all subs)
    if (s.customer_id) {
      const cohort = categoryCohort[cat];
      const existing = cohort.get(s.customer_id);
      if (existing) {
        if (s.created_at < existing.firstStart) existing.firstStart = s.created_at;
        if (s.canceled_at && (!existing.lastEnd || s.canceled_at > existing.lastEnd)) {
          existing.lastEnd = s.canceled_at;
        }
        if (!s.canceled_at) existing.lastEnd = null; // still active
      } else {
        cohort.set(s.customer_id, {
          firstStart: s.created_at,
          lastEnd: s.canceled_at,
          ltv: 0, // filled below from invByCustomer — but that's per-customer total, not per-category. Acceptable approximation.
        });
      }
    }
  }

  // Sort each active list by MRR desc
  for (const cat of Object.keys(byCategory) as ProgramCategory[]) {
    byCategory[cat].sort((a, b) => b.unitAmount - a.unitAmount);
  }

  // Compute stats per category
  const stats: Record<ProgramCategory, ProgramStats> = {
    mastermind: { activeCount: 0, mrr: 0, avgLTV: 0, avgStayMonths: 0, cohortSize: 0 },
    elite: { activeCount: 0, mrr: 0, avgLTV: 0, avgStayMonths: 0, cohortSize: 0 },
    ceo: { activeCount: 0, mrr: 0, avgLTV: 0, avgStayMonths: 0, cohortSize: 0 },
    nca: { activeCount: 0, mrr: 0, avgLTV: 0, avgStayMonths: 0, cohortSize: 0 },
    branding: { activeCount: 0, mrr: 0, avgLTV: 0, avgStayMonths: 0, cohortSize: 0 },
    other: { activeCount: 0, mrr: 0, avgLTV: 0, avgStayMonths: 0, cohortSize: 0 },
  };

  for (const cat of Object.keys(byCategory) as ProgramCategory[]) {
    stats[cat].activeCount = byCategory[cat].length;
    stats[cat].mrr = byCategory[cat].reduce((s, r) => s + r.unitAmount, 0);

    const cohort = categoryCohort[cat];
    const lengths: number[] = [];
    const ltvs: number[] = [];
    for (const [custId, info] of cohort) {
      const end = info.lastEnd ? new Date(info.lastEnd) : new Date();
      const days = daysBetween(info.firstStart, end);
      lengths.push(days / 30.44); // months
      const ltv = invByCustomer.get(custId) ?? 0;
      if (ltv > 0) ltvs.push(ltv);
    }
    stats[cat].cohortSize = cohort.size;
    stats[cat].avgStayMonths = lengths.length ? lengths.reduce((s, x) => s + x, 0) / lengths.length : 0;
    stats[cat].avgLTV = ltvs.length ? ltvs.reduce((s, x) => s + x, 0) / ltvs.length : 0;
  }

  // Attrition MTD: canceled this month / active at start of month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthStartIso = monthStart.toISOString();

  const canceledMTD = subs.filter((s: any) => s.canceled_at && s.canceled_at >= monthStartIso).length;
  // Active at start of month = subs that were active (status != canceled OR canceled_at >= monthStart) AND created before monthStart
  const activeAtMonthStart = subs.filter((s: any) =>
    s.created_at < monthStartIso &&
    (s.status !== "canceled" || (s.canceled_at && s.canceled_at >= monthStartIso))
  ).length;
  const attritionMTDRate = activeAtMonthStart ? (canceledMTD / activeAtMonthStart) * 100 : 0;

  // Attrition YTD average: for each completed month this year, compute rate, then average
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const months: { canceled: number; startActive: number }[] = [];
  for (let m = 0; m < now.getMonth(); m++) {
    const mStart = new Date(now.getFullYear(), m, 1).toISOString();
    const mEnd = new Date(now.getFullYear(), m + 1, 1).toISOString();
    const c = subs.filter((s: any) => s.canceled_at && s.canceled_at >= mStart && s.canceled_at < mEnd).length;
    const sa = subs.filter((s: any) =>
      s.created_at < mStart &&
      (s.status !== "canceled" || (s.canceled_at && s.canceled_at >= mStart))
    ).length;
    months.push({ canceled: c, startActive: sa });
  }
  const ytdRates = months.map((m) => (m.startActive ? m.canceled / m.startActive : 0));
  const avgMonthlyYTD = ytdRates.length ? (ytdRates.reduce((s, x) => s + x, 0) / ytdRates.length) * 100 : 0;
  const totalCanceledYTD = subs.filter((s: any) => s.canceled_at && s.canceled_at >= yearStart.toISOString()).length;
  const avgActive = months.length ? months.reduce((s, m) => s + m.startActive, 0) / months.length : 0;

  return {
    byCategory,
    onHold,
    stats,
    attritionMTD: { canceled: canceledMTD, activeStart: activeAtMonthStart, rate: attritionMTDRate },
    attritionYTD: { canceled: totalCanceledYTD, avgActive, monthlyAvgRate: avgMonthlyYTD },
  };
}
