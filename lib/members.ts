// Members view — authoritative source is the SPF MASTER Member List Google Sheet
// (synced into master_members table). Stripe provides financial data (MRR, LTV, etc.)

import { createServerClient } from "./supabase";

export type ProgramKey = "mastermind" | "elite" | "ceo" | "nca" | "other";

export type MemberRow = {
  id: string;
  name: string | null;
  email: string | null; // primary (first) email
  allEmails: string[];
  phone: string | null;
  gymName: string | null;
  tier: string | null; // raw tier from master list (Mastermind, CEO 1, CEO 2, Elite, NCA)
  category: ProgramKey;
  dateJoined: string | null;
  canceledDate: string | null;
  staff: string | null;
  address: string | null;
  // Stripe enrichment
  stripeCustomerId: string | null;
  stripeStatus: string | null;
  currentMrr: number; // sum of active sub unit_amounts
  lastPaidAt: string | null;
  totalPaid: number; // lifetime paid
  activeProducts: string[];
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
  byCategory: Record<ProgramKey, MemberRow[]>;
  alumniByCategory: Record<ProgramKey, MemberRow[]>;
  onHold: MemberRow[];
  terminatedMTD: MemberRow[];
  terminatedYTD: MemberRow[];
  stats: Record<ProgramKey, ProgramStats>;
  attritionMTD: { canceled: number; activeStart: number; rate: number };
  attritionYTD: { canceled: number; avgActive: number; monthlyAvgRate: number };
  unmatchedStripeActive: { name: string | null; email: string | null; product: string | null; mrr: number }[];
};

function categoryFromTier(tier: string | null): ProgramKey {
  if (!tier) return "other";
  const t = tier.toLowerCase();
  if (t.includes("mastermind")) return "mastermind";
  if (t.includes("elite")) return "elite";
  if (t.startsWith("ceo")) return "ceo";
  if (t.includes("nca")) return "nca";
  return "other";
}

function daysBetween(a: string | Date, b: string | Date): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
}

const emptyCatRec = <T>(v: () => T): Record<ProgramKey, T> => ({
  mastermind: v(), elite: v(), ceo: v(), nca: v(), other: v(),
});

export async function loadMembersData(): Promise<MembersData> {
  const sb = createServerClient();

  const [masterRes, subsRes, invoicesRes, customersRes] = await Promise.all([
    sb.from("master_members").select("*"),
    sb.from("stripe_subscriptions").select("id, customer_id, status, unit_amount, interval, created_at, canceled_at, product_name"),
    sb.from("stripe_invoices").select("customer_id, subscription_id, amount_paid, paid_at").eq("status", "paid"),
    sb.from("stripe_customers").select("id, email, name, phone, address"),
  ]);

  const master = (masterRes.data ?? []) as any[];
  const subs = (subsRes.data ?? []) as any[];
  const invoices = (invoicesRes.data ?? []) as any[];
  const customers = (customersRes.data ?? []) as any[];

  // Build email → Stripe customer lookup
  const custByEmail = new Map<string, any>();
  for (const c of customers) {
    if (c.email) custByEmail.set(c.email.toLowerCase().trim(), c);
  }

  // Build customer_id → subs + invoice totals
  const subsByCustomer = new Map<string, any[]>();
  for (const s of subs) {
    if (!s.customer_id) continue;
    const arr = subsByCustomer.get(s.customer_id) ?? [];
    arr.push(s);
    subsByCustomer.set(s.customer_id, arr);
  }
  const invTotalByCustomer = new Map<string, { total: number; last: string }>();
  for (const inv of invoices) {
    if (!inv.customer_id) continue;
    const cur = invTotalByCustomer.get(inv.customer_id) ?? { total: 0, last: "" };
    cur.total += Number(inv.amount_paid ?? 0);
    if (inv.paid_at && inv.paid_at > cur.last) cur.last = inv.paid_at;
    invTotalByCustomer.set(inv.customer_id, cur);
  }

  // Group master rows by name (multi-email team member = 1 person)
  type GroupKey = string; // `${source_tab}|${name}|${tier}`
  const groups = new Map<GroupKey, { rows: any[]; emails: Set<string> }>();
  for (const m of master) {
    const key = `${m.source_tab}|${(m.name ?? "").toLowerCase().trim()}|${m.tier ?? ""}`;
    const g = groups.get(key) ?? { rows: [], emails: new Set<string>() };
    g.rows.push(m);
    if (m.email) g.emails.add(m.email.toLowerCase().trim());
    groups.set(key, g);
  }

  const byCategory: Record<ProgramKey, MemberRow[]> = emptyCatRec(() => []);
  const alumniByCategory: Record<ProgramKey, MemberRow[]> = emptyCatRec(() => []);

  // Track which Stripe customers are matched to the master list (for "unmatched" reporting)
  const matchedCustomerIds = new Set<string>();

  for (const [_key, g] of groups) {
    const primary = g.rows[0];
    const emails = Array.from(g.emails);
    const cat = categoryFromTier(primary.tier);

    // Find Stripe customer via any email
    let stripeCustomer: any = null;
    for (const e of emails) {
      const c = custByEmail.get(e);
      if (c) { stripeCustomer = c; break; }
    }
    const custId = stripeCustomer?.id ?? null;
    if (custId) matchedCustomerIds.add(custId);

    // Compute financials from Stripe
    const custSubs = custId ? (subsByCustomer.get(custId) ?? []) : [];
    const activeSubs = custSubs.filter((s) => s.status === "active");
    const currentMrr = activeSubs.reduce((s, x) => s + Number(x.unit_amount ?? 0), 0);
    const activeProducts = Array.from(new Set(activeSubs.map((s) => s.product_name).filter(Boolean)));
    const invData = custId ? invTotalByCustomer.get(custId) : null;

    const addr = stripeCustomer?.address;
    const addrStr = addr
      ? [addr.line1, addr.city, addr.state, addr.postal_code].filter(Boolean).join(", ")
      : (primary.address ?? null);

    const row: MemberRow = {
      id: `${primary.source_tab}:${primary.name}:${primary.tier}`,
      name: primary.name ?? stripeCustomer?.name ?? null,
      email: emails[0] ?? null,
      allEmails: emails,
      phone: stripeCustomer?.phone ?? null,
      gymName: primary.gym_name ?? null,
      tier: primary.tier ?? null,
      category: cat,
      dateJoined: primary.date_joined ?? null,
      canceledDate: primary.canceled_date ?? null,
      staff: primary.staff ?? null,
      address: addrStr,
      stripeCustomerId: custId,
      stripeStatus: activeSubs[0]?.status ?? null,
      currentMrr,
      lastPaidAt: invData?.last ?? null,
      totalPaid: invData?.total ?? 0,
      activeProducts,
    };

    if (primary.source_tab === "Cancelations") {
      alumniByCategory[cat].push(row);
    } else {
      byCategory[cat].push(row);
    }
  }

  // Unmatched: Stripe active subscribers whose customer_id isn't tied to any master_members email
  const unmatched: MembersData["unmatchedStripeActive"] = [];
  for (const s of subs) {
    if (s.status !== "active") continue;
    if (s.customer_id && matchedCustomerIds.has(s.customer_id)) continue;
    const cust = customers.find((c) => c.id === s.customer_id);
    unmatched.push({
      name: cust?.name ?? null,
      email: cust?.email ?? null,
      product: s.product_name ?? null,
      mrr: Number(s.unit_amount ?? 0),
    });
  }

  // Sort each list
  for (const k of Object.keys(byCategory) as ProgramKey[]) {
    byCategory[k].sort((a, b) => b.currentMrr - a.currentMrr || (a.name ?? "").localeCompare(b.name ?? ""));
    alumniByCategory[k].sort((a, b) => (b.canceledDate ?? "").localeCompare(a.canceledDate ?? ""));
  }

  // Attrition MTD / YTD — compute from Stripe subs (not master list)
  const now = new Date();
  const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const yearStartIso = new Date(now.getFullYear(), 0, 1).toISOString();

  const canceledMTD = subs.filter((s) => s.canceled_at && s.canceled_at >= monthStartIso).length;
  const activeAtMonthStart = subs.filter((s) =>
    s.created_at < monthStartIso &&
    (s.status !== "canceled" || (s.canceled_at && s.canceled_at >= monthStartIso))
  ).length;
  const attritionMTDRate = activeAtMonthStart ? (canceledMTD / activeAtMonthStart) * 100 : 0;

  const monthsYTD: { canceled: number; startActive: number }[] = [];
  for (let m = 0; m < now.getMonth(); m++) {
    const mStart = new Date(now.getFullYear(), m, 1).toISOString();
    const mEnd = new Date(now.getFullYear(), m + 1, 1).toISOString();
    const c = subs.filter((s) => s.canceled_at && s.canceled_at >= mStart && s.canceled_at < mEnd).length;
    const sa = subs.filter((s) =>
      s.created_at < mStart &&
      (s.status !== "canceled" || (s.canceled_at && s.canceled_at >= mStart))
    ).length;
    monthsYTD.push({ canceled: c, startActive: sa });
  }
  const ytdRates = monthsYTD.map((m) => (m.startActive ? m.canceled / m.startActive : 0));
  const avgMonthlyYTD = ytdRates.length ? (ytdRates.reduce((s, x) => s + x, 0) / ytdRates.length) * 100 : 0;
  const totalCanceledYTD = subs.filter((s) => s.canceled_at && s.canceled_at >= yearStartIso).length;
  const avgActive = monthsYTD.length ? monthsYTD.reduce((s, m) => s + m.startActive, 0) / monthsYTD.length : 0;

  // Terminations — use Stripe canceled_at for date, match to master list for tier
  const terminatedMTD: MemberRow[] = [];
  const terminatedYTD: MemberRow[] = [];
  for (const s of subs) {
    if (!s.canceled_at) continue;
    if (s.canceled_at < yearStartIso) continue;
    const cust = customers.find((c) => c.id === s.customer_id);
    const email = cust?.email?.toLowerCase() ?? "";
    // find master row
    const masterMatch = master.find((m) => m.email?.toLowerCase() === email);
    const cat = masterMatch ? categoryFromTier(masterMatch.tier) : categoryFromTier(s.product_name);
    const row: MemberRow = {
      id: `term-${s.id}`,
      name: masterMatch?.name ?? cust?.name ?? null,
      email: cust?.email ?? null,
      allEmails: cust?.email ? [cust.email.toLowerCase()] : [],
      phone: cust?.phone ?? null,
      gymName: masterMatch?.gym_name ?? null,
      tier: masterMatch?.tier ?? s.product_name ?? null,
      category: cat,
      dateJoined: masterMatch?.date_joined ?? s.created_at ?? null,
      canceledDate: s.canceled_at,
      staff: null,
      address: null,
      stripeCustomerId: s.customer_id,
      stripeStatus: s.status,
      currentMrr: 0,
      lastPaidAt: null,
      totalPaid: 0,
      activeProducts: [],
    };
    terminatedYTD.push(row);
    if (s.canceled_at >= monthStartIso) terminatedMTD.push(row);
  }
  terminatedMTD.sort((a, b) => (b.canceledDate ?? "").localeCompare(a.canceledDate ?? ""));
  terminatedYTD.sort((a, b) => (b.canceledDate ?? "").localeCompare(a.canceledDate ?? ""));

  // Stats per category
  const stats: Record<ProgramKey, ProgramStats> = emptyCatRec(() => ({
    activeCount: 0, alumniCount: 0, mrr: 0, avgLTV: 0, avgStayMonths: 0, cohortSize: 0,
  }));

  for (const cat of Object.keys(byCategory) as ProgramKey[]) {
    const active = byCategory[cat];
    const alumni = alumniByCategory[cat];
    stats[cat].activeCount = active.length;
    stats[cat].alumniCount = alumni.length;
    stats[cat].mrr = active.reduce((s, r) => s + r.currentMrr, 0);
    stats[cat].cohortSize = active.length + alumni.length;

    const ltvs = [...active, ...alumni].map((r) => r.totalPaid).filter((v) => v > 0);
    stats[cat].avgLTV = ltvs.length ? ltvs.reduce((s, x) => s + x, 0) / ltvs.length : 0;

    // Length of stay: date_joined → canceled_date (or now for active)
    const lengths: number[] = [];
    for (const r of [...active, ...alumni]) {
      if (!r.dateJoined) continue;
      const start = new Date(r.dateJoined);
      if (isNaN(start.getTime())) continue;
      const end = r.canceledDate ? new Date(r.canceledDate) : new Date();
      if (isNaN(end.getTime())) continue;
      const days = daysBetween(start, end);
      if (days > 0) lengths.push(days / 30.44);
    }
    stats[cat].avgStayMonths = lengths.length ? lengths.reduce((s, x) => s + x, 0) / lengths.length : 0;
  }

  return {
    byCategory,
    alumniByCategory,
    onHold: [],
    terminatedMTD,
    terminatedYTD,
    stats,
    attritionMTD: { canceled: canceledMTD, activeStart: activeAtMonthStart, rate: attritionMTDRate },
    attritionYTD: { canceled: totalCanceledYTD, avgActive, monthlyAvgRate: avgMonthlyYTD },
    unmatchedStripeActive: unmatched,
  };
}
