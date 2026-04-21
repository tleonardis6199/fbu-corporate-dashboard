// Server-side aggregator for the Members view on Past Purchasers page.
// Active = Stripe status='active' OR paid invoice on this category in last 365 days.
// This handles: recurring subs, prepaid annuals, CEO (irregular), Elite add-ons.

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
  lastPaidAt: string | null;
  totalPaid: number;
  // customer
  name: string | null;
  email: string | null;
  phone: string | null;
  businessName: string | null;
  address: string | null;
};

export type ProgramStats = {
  activeCount: number;
  alumniCount: number;
  mrr: number;
  avgLTV: number;
  avgStayMonths: number;
  cohortSize: number;
};

export type MembersData = {
  byCategory: Record<ProgramCategory, MemberRow[]>;
  alumniByCategory: Record<ProgramCategory, MemberRow[]>;
  onHold: MemberRow[];
  terminatedMTD: MemberRow[];
  terminatedYTD: MemberRow[];
  stats: Record<ProgramCategory, ProgramStats>;
  attritionMTD: { canceled: number; activeStart: number; rate: number };
  attritionYTD: { canceled: number; avgActive: number; monthlyAvgRate: number };
};

function daysBetween(a: string | Date, b: string | Date): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
}

const emptyCatRec = <T>(v: () => T): Record<ProgramCategory, T> => ({
  mastermind: v(), elite: v(), ceo: v(), nca: v(), branding: v(), other: v(),
});

export async function loadMembersData(): Promise<MembersData> {
  const sb = createServerClient();

  const twelveMonthsAgoIsoForPIF = new Date(Date.now() - 365 * 86400000).toISOString();

  const [subsRes, invoicesRes, pifChargesRes] = await Promise.all([
    sb
      .from("stripe_subscriptions")
      .select("id, customer_id, status, unit_amount, interval, created_at, canceled_at, product_name, stripe_customers(name, email, phone, address, metadata)")
      .gte("created_at", "2017-01-01"),
    sb
      .from("stripe_invoices")
      .select("subscription_id, amount_paid, paid_at")
      .eq("status", "paid")
      .gte("paid_at", "2017-01-01"),
    // PIF Mastermind charges: direct charges ≥ $5k in last 365d with PIF description
    sb
      .from("stripe_charges")
      .select("id, customer_id, amount, description, created_at, stripe_customers(name, email, phone, address, metadata)")
      .eq("status", "succeeded")
      .gte("amount", 5000)
      .gte("created_at", twelveMonthsAgoIsoForPIF),
  ]);

  const subs = (subsRes.data ?? []) as any[];
  const invoices = (invoicesRes.data ?? []) as any[];
  const pifCandidates = ((pifChargesRes.data ?? []) as any[]).filter((ch) => {
    const d = (ch.description ?? "").toLowerCase();
    return /\bpif\b|paid in full|mastermind/.test(d);
  });

  // Build sub_id → product_name, customer_id, category lookup
  const subMeta = new Map<string, { customerId: string | null; category: ProgramCategory }>();
  for (const s of subs) {
    subMeta.set(s.id, {
      customerId: s.customer_id,
      category: categorizeProduct(s.product_name),
    });
  }

  // Aggregate invoice data per (customer, category)
  type InvKey = string; // `${customerId}|${category}`
  const invAgg = new Map<InvKey, { total: number; lastPaidAt: string }>();
  // Per-subscription also
  const invBySub = new Map<string, { total: number; lastPaidAt: string }>();
  // Per-customer total (for LTV)
  const ltvByCustomer = new Map<string, number>();

  for (const inv of invoices) {
    const meta = subMeta.get(inv.subscription_id);
    if (!meta || !meta.customerId || !inv.paid_at) continue;
    const amt = Number(inv.amount_paid ?? 0);
    const key: InvKey = `${meta.customerId}|${meta.category}`;
    const cur = invAgg.get(key);
    if (!cur || inv.paid_at > cur.lastPaidAt) {
      invAgg.set(key, {
        total: (cur?.total ?? 0) + amt,
        lastPaidAt: cur && inv.paid_at <= cur.lastPaidAt ? cur.lastPaidAt : inv.paid_at,
      });
    } else {
      cur.total += amt;
    }
    // per-sub
    const curSub = invBySub.get(inv.subscription_id) ?? { total: 0, lastPaidAt: inv.paid_at };
    curSub.total += amt;
    if (inv.paid_at > curSub.lastPaidAt) curSub.lastPaidAt = inv.paid_at;
    invBySub.set(inv.subscription_id, curSub);
    // per-customer LTV
    ltvByCustomer.set(meta.customerId, (ltvByCustomer.get(meta.customerId) ?? 0) + amt);
  }

  const now = Date.now();
  const twelveMonthsAgoIso = new Date(now - 365 * 86400000).toISOString();
  const monthStartIso = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const yearStartIso = new Date(new Date().getFullYear(), 0, 1).toISOString();

  // Group subs by category + customer → pick "primary" row (latest created)
  type GroupKey = string; // `${category}|${customerId}`
  const groups = new Map<GroupKey, {
    category: ProgramCategory;
    customer: any;
    subs: any[]; // raw sub rows
    hasActiveSub: boolean;
    hasPausedSub: boolean;
  }>();

  for (const s of subs) {
    const cat = categorizeProduct(s.product_name);
    const custId = s.customer_id;
    if (!custId) continue;
    const key: GroupKey = `${cat}|${custId}`;
    const g = groups.get(key) ?? {
      category: cat,
      customer: s.stripe_customers ?? {},
      subs: [],
      hasActiveSub: false,
      hasPausedSub: false,
    };
    g.subs.push(s);
    if (s.status === "active") g.hasActiveSub = true;
    if (s.status === "paused") g.hasPausedSub = true;
    groups.set(key, g);
  }

  // Build classified rows
  const byCategory: Record<ProgramCategory, MemberRow[]> = emptyCatRec(() => []);
  const alumniByCategory: Record<ProgramCategory, MemberRow[]> = emptyCatRec(() => []);
  const onHold: MemberRow[] = [];
  const terminatedMTD: MemberRow[] = [];
  const terminatedYTD: MemberRow[] = [];

  const rowFromSub = (s: any, category: ProgramCategory, custInfo: any): MemberRow => {
    const addr = custInfo.address;
    const addrStr = addr
      ? [addr.line1, addr.city, addr.state, addr.postal_code].filter(Boolean).join(", ")
      : null;
    const subInv = invBySub.get(s.id);
    return {
      subId: s.id,
      customerId: s.customer_id,
      productName: s.product_name,
      category,
      status: s.status,
      unitAmount: Number(s.unit_amount ?? 0),
      interval: s.interval,
      createdAt: s.created_at,
      canceledAt: s.canceled_at,
      lastPaidAt: subInv?.lastPaidAt ?? null,
      totalPaid: subInv?.total ?? 0,
      name: custInfo.name ?? null,
      email: custInfo.email ?? null,
      phone: custInfo.phone ?? null,
      businessName: custInfo.metadata?.business_name ?? custInfo.metadata?.gym_name ?? null,
      address: addrStr,
    };
  };

  for (const g of groups.values()) {
    // Pick representative sub: prefer active > paused > most-recent-paid > most-recent-created
    const sorted = [...g.subs].sort((a, b) => {
      const ar = a.status === "active" ? 3 : a.status === "paused" ? 2 : 1;
      const br = b.status === "active" ? 3 : b.status === "paused" ? 2 : 1;
      if (ar !== br) return br - ar;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    const primary = sorted[0];
    const row = rowFromSub(primary, g.category, g.customer);

    const invKey = `${primary.customer_id}|${g.category}`;
    const agg = invAgg.get(invKey);
    if (agg) {
      row.lastPaidAt = agg.lastPaidAt;
      row.totalPaid = agg.total;
    }

    // CEO uses "billed in last 12 months" because it bills irregularly.
    // All other programs use strict Stripe status='active' (monthly recurring).
    const billedRecently = row.lastPaidAt && row.lastPaidAt >= twelveMonthsAgoIso;
    const isActive =
      g.category === "ceo"
        ? (g.hasActiveSub || billedRecently)
        : g.hasActiveSub;

    if (isActive) {
      byCategory[g.category].push(row);
    } else if (row.totalPaid > 0) {
      alumniByCategory[g.category].push(row);
    }

    if (g.hasPausedSub) {
      onHold.push(row);
    }

    // Termination tracking: any sub in this group canceled this MTD / YTD
    for (const s of g.subs) {
      if (!s.canceled_at) continue;
      if (s.canceled_at >= monthStartIso) {
        terminatedMTD.push(rowFromSub(s, g.category, g.customer));
      }
      if (s.canceled_at >= yearStartIso) {
        terminatedYTD.push(rowFromSub(s, g.category, g.customer));
      }
    }
  }

  // Add PIF Mastermind members (direct charges ≥ $5k with PIF description,
  // not tied to a subscription, within last 365 days).
  const existingMastermindCustomers = new Set(
    byCategory.mastermind.map((r) => r.customerId).filter(Boolean)
  );
  for (const ch of pifCandidates) {
    if (!ch.customer_id || existingMastermindCustomers.has(ch.customer_id)) continue;
    const cust = ch.stripe_customers ?? {};
    const addr = cust.address;
    const addrStr = addr
      ? [addr.line1, addr.city, addr.state, addr.postal_code].filter(Boolean).join(", ")
      : null;
    const amount = Number(ch.amount);
    byCategory.mastermind.push({
      subId: ch.id,
      customerId: ch.customer_id,
      productName: `Mastermind PIF (${ch.description ?? "paid in full"}) — $${amount.toLocaleString()}`,
      category: "mastermind",
      status: "active",
      unitAmount: Math.round(amount / 12),
      interval: "month",
      createdAt: ch.created_at,
      canceledAt: null,
      lastPaidAt: ch.created_at,
      totalPaid: amount,
      name: cust.name ?? null,
      email: cust.email ?? null,
      phone: cust.phone ?? null,
      businessName: cust.metadata?.business_name ?? cust.metadata?.gym_name ?? null,
      address: addrStr,
    });
    existingMastermindCustomers.add(ch.customer_id);
  }

  // Sort
  for (const cat of Object.keys(byCategory) as ProgramCategory[]) {
    byCategory[cat].sort((a, b) => b.unitAmount - a.unitAmount);
    alumniByCategory[cat].sort((a, b) => {
      const at = a.lastPaidAt ?? "";
      const bt = b.lastPaidAt ?? "";
      return bt.localeCompare(at);
    });
  }
  terminatedMTD.sort((a, b) => (b.canceledAt ?? "").localeCompare(a.canceledAt ?? ""));
  terminatedYTD.sort((a, b) => (b.canceledAt ?? "").localeCompare(a.canceledAt ?? ""));

  // Stats
  const stats: Record<ProgramCategory, ProgramStats> = emptyCatRec(() => ({
    activeCount: 0, alumniCount: 0, mrr: 0, avgLTV: 0, avgStayMonths: 0, cohortSize: 0,
  }));

  for (const cat of Object.keys(byCategory) as ProgramCategory[]) {
    stats[cat].activeCount = byCategory[cat].length;
    stats[cat].alumniCount = alumniByCategory[cat].length;
    stats[cat].mrr = byCategory[cat].reduce((s, r) => s + (r.status === "active" ? r.unitAmount : 0), 0);

    // Cohort: customers who ever had a sub in this category
    const cohortCustomers = new Set<string>();
    for (const s of subs) {
      if (categorizeProduct(s.product_name) === cat && s.customer_id) {
        cohortCustomers.add(s.customer_id);
      }
    }
    stats[cat].cohortSize = cohortCustomers.size;

    // Length of stay: for each cohort customer, min(created) → max(canceled or now)
    const lengths: number[] = [];
    const ltvs: number[] = [];
    for (const custId of cohortCustomers) {
      const custSubs = subs.filter(
        (s: any) => s.customer_id === custId && categorizeProduct(s.product_name) === cat
      );
      if (custSubs.length === 0) continue;
      const firstStart = custSubs
        .map((s: any) => s.created_at)
        .sort()[0];
      const anyActive = custSubs.some((s: any) => s.status === "active" || s.status === "paused");
      let endDate: Date;
      if (anyActive) {
        endDate = new Date();
      } else {
        const latestCancel = custSubs
          .map((s: any) => s.canceled_at)
          .filter(Boolean)
          .sort()
          .pop();
        endDate = latestCancel ? new Date(latestCancel) : new Date();
      }
      lengths.push(daysBetween(firstStart, endDate) / 30.44);
      const catKey = `${custId}|${cat}`;
      const agg = invAgg.get(catKey);
      if (agg && agg.total > 0) ltvs.push(agg.total);
    }
    stats[cat].avgStayMonths = lengths.length ? lengths.reduce((s, x) => s + x, 0) / lengths.length : 0;
    stats[cat].avgLTV = ltvs.length ? ltvs.reduce((s, x) => s + x, 0) / ltvs.length : 0;
  }

  // Attrition MTD / YTD
  const canceledMTD = subs.filter((s: any) => s.canceled_at && s.canceled_at >= monthStartIso).length;
  const activeAtMonthStart = subs.filter((s: any) =>
    s.created_at < monthStartIso &&
    (s.status !== "canceled" || (s.canceled_at && s.canceled_at >= monthStartIso))
  ).length;
  const attritionMTDRate = activeAtMonthStart ? (canceledMTD / activeAtMonthStart) * 100 : 0;

  const now2 = new Date();
  const months: { canceled: number; startActive: number }[] = [];
  for (let m = 0; m < now2.getMonth(); m++) {
    const mStart = new Date(now2.getFullYear(), m, 1).toISOString();
    const mEnd = new Date(now2.getFullYear(), m + 1, 1).toISOString();
    const c = subs.filter((s: any) => s.canceled_at && s.canceled_at >= mStart && s.canceled_at < mEnd).length;
    const sa = subs.filter((s: any) =>
      s.created_at < mStart &&
      (s.status !== "canceled" || (s.canceled_at && s.canceled_at >= mStart))
    ).length;
    months.push({ canceled: c, startActive: sa });
  }
  const ytdRates = months.map((m) => (m.startActive ? m.canceled / m.startActive : 0));
  const avgMonthlyYTD = ytdRates.length ? (ytdRates.reduce((s, x) => s + x, 0) / ytdRates.length) * 100 : 0;
  const totalCanceledYTD = subs.filter((s: any) => s.canceled_at && s.canceled_at >= yearStartIso).length;
  const avgActive = months.length ? months.reduce((s, m) => s + m.startActive, 0) / months.length : 0;

  return {
    byCategory,
    alumniByCategory,
    onHold,
    terminatedMTD,
    terminatedYTD,
    stats,
    attritionMTD: { canceled: canceledMTD, activeStart: activeAtMonthStart, rate: attritionMTDRate },
    attritionYTD: { canceled: totalCanceledYTD, avgActive, monthlyAvgRate: avgMonthlyYTD },
  };
}
