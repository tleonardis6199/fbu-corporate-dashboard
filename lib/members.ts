// Members view — authoritative source is the SPF MASTER Member List Google Sheet.
// Primary truth for ACTIVE/HOLD/COMPED/CANCELLED: "SPF Payment Schedules" tab.
// Tier enrichment (gym name, address, date joined): "SPF Master List" tab + "Elite" + "Cancelations" + "NCA/Payment Schedule" tabs.
// Stripe provides financial details (LTV, last paid, products).

import { createServerClient } from "./supabase";

export type ProgramKey = "mastermind" | "elite" | "ceo" | "nca" | "other";
export type MemberStatus = "active" | "hold" | "comped" | "cancelled" | "offsite" | "nonpaying";

export type MemberRow = {
  id: string;
  name: string | null;
  email: string | null;
  allEmails: string[];
  phone: string | null;
  gymName: string | null;
  tier: string | null;
  category: ProgramKey;
  status: MemberStatus;
  dateJoined: string | null;
  canceledDate: string | null;
  staff: string | null;
  address: string | null;
  notes: string | null;
  // Amounts from sheet (what they're actually billed)
  spfAmount: number;
  ceoAmount: number;
  eliteAmount: number;
  monthlyTotal: number;
  // Stripe enrichment
  stripeCustomerId: string | null;
  currentMrr: number;
  lastPaidAt: string | null;
  totalPaid: number;
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
  // Grouped by program category for active + alumni
  activeByCategory: Record<ProgramKey, MemberRow[]>;
  alumniByCategory: Record<ProgramKey, MemberRow[]>;
  // Lists independent of category
  onHold: MemberRow[];
  comped: MemberRow[];
  needsBillingAttention: (MemberRow & { attentionReason: string })[];
  terminatedMTD: MemberRow[];
  terminatedYTD: MemberRow[];
  // Counts
  stats: Record<ProgramKey, ProgramStats>;
  totalActiveAll: number;
  totalActiveCEO: number;
  totalActiveElite: number;
  // Attrition
  attritionMTD: { canceled: number; activeStart: number; rate: number };
  attritionYTD: { canceled: number; avgActive: number; monthlyAvgRate: number };
};

function parseMoney(s: string | null | undefined): number {
  if (!s) return 0;
  const cleaned = String(s).replace(/[$,]/g, "").replace(/\(.*\)/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function daysBetween(a: string | Date, b: string | Date): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
}

function normalizeName(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().replace(/\*+$/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const emptyCatRec = <T>(v: () => T): Record<ProgramKey, T> => ({
  mastermind: v(), elite: v(), ceo: v(), nca: v(), other: v(),
});

function categoryFromTier(tier: string | null): ProgramKey {
  if (!tier) return "other";
  const t = tier.toLowerCase();
  if (t.includes("mastermind")) return "mastermind";
  if (t.includes("elite")) return "elite";
  if (t.startsWith("ceo")) return "ceo";
  if (t.includes("nca")) return "nca";
  return "other";
}

export async function loadMembersData(): Promise<MembersData> {
  const sb = createServerClient();

  const [masterRes, subsRes, invoicesRes, customersRes] = await Promise.all([
    sb.from("master_members").select("*"),
    sb.from("stripe_subscriptions").select("id, customer_id, status, unit_amount, interval, created_at, canceled_at, product_name"),
    sb.from("stripe_invoices").select("customer_id, amount_paid, paid_at").eq("status", "paid"),
    sb.from("stripe_customers").select("id, email, name, phone, address"),
  ]);

  const master = (masterRes.data ?? []) as any[];
  const subs = (subsRes.data ?? []) as any[];
  const invoices = (invoicesRes.data ?? []) as any[];
  const customers = (customersRes.data ?? []) as any[];

  // Lookup: email → ALL Stripe customers sharing that email (Stripe duplicates per email).
  const custsByEmail = new Map<string, any[]>();
  for (const c of customers) {
    if (!c.email) continue;
    const k = c.email.toLowerCase().trim();
    const arr = custsByEmail.get(k) ?? [];
    arr.push(c);
    custsByEmail.set(k, arr);
  }
  // Lookup: normalized name → Stripe customer
  const custByName = new Map<string, any>();
  for (const c of customers) {
    if (c.name) {
      const key = normalizeName(c.name);
      if (key && !custByName.has(key)) custByName.set(key, c);
    }
  }

  // Aggregate Stripe data per customer
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

  // Separate master rows by source
  const paymentSchedRows = master.filter((m) => m.source_tab?.startsWith("Payment Schedules"));
  const masterListRows = master.filter((m) => m.source_tab === "SPF Master List");
  const eliteRows = master.filter((m) => m.source_tab === "Elite");
  const cancelationRows = master.filter((m) => m.source_tab === "Cancelations");
  const ncaRows = master.filter((m) => m.source_tab === "NCA/Payment Schedule");

  // Master List as enrichment: name → row (for tier, gym, address)
  const masterByName = new Map<string, any>();
  for (const m of masterListRows) {
    const key = normalizeName(m.name);
    if (key && !masterByName.has(key)) masterByName.set(key, m);
  }
  // Elite tab: name → row
  const eliteByName = new Set<string>();
  for (const e of eliteRows) {
    const key = normalizeName(e.name);
    if (key) eliteByName.add(key);
  }

  const activeByCategory: Record<ProgramKey, MemberRow[]> = emptyCatRec(() => []);
  const alumniByCategory: Record<ProgramKey, MemberRow[]> = emptyCatRec(() => []);
  const onHold: MemberRow[] = [];
  const comped: MemberRow[] = [];
  const needsBillingAttention: (MemberRow & { attentionReason: string })[] = [];

  // Build rows from Payment Schedules (authoritative for status)
  for (const ps of paymentSchedRows) {
    const name = ps.name;
    if (!name) continue;
    const nameKey = normalizeName(name);
    const masterHit = masterByName.get(nameKey);
    const isElite = eliteByName.has(nameKey);
    const r = ps.raw ?? {};

    // Collect all known emails for this person across master tabs
    const emails: string[] = [];
    for (const mm of master) {
      if (mm.email?.startsWith("payment-schedule:")) continue;
      if (normalizeName(mm.name) === nameKey && mm.email) {
        emails.push(mm.email.toLowerCase().trim());
      }
    }
    const allEmailsSet = Array.from(new Set(emails));

    // Find ALL Stripe customer records across all emails (Stripe creates dupes per email)
    const allStripeCusts: any[] = [];
    for (const e of allEmailsSet) {
      const matches = custsByEmail.get(e) ?? [];
      for (const c of matches) allStripeCusts.push(c);
    }
    // Fallback: name match (handles missing-email cases)
    if (allStripeCusts.length === 0) {
      const byName = custByName.get(nameKey);
      if (byName) allStripeCusts.push(byName);
    }

    // Aggregate subs across all duplicate customer records
    const allCustSubs: any[] = [];
    for (const c of allStripeCusts) {
      const cs = subsByCustomer.get(c.id) ?? [];
      for (const s of cs) allCustSubs.push(s);
    }
    const activeSubs = allCustSubs.filter((s) => s.status === "active");
    const pastDueSubs = allCustSubs.filter((s) => s.status === "past_due" || s.status === "unpaid");
    const activeMMSubs = activeSubs.filter((s) => /mastermind|new client academy|nca/i.test(s.product_name ?? ""));
    const activeProducts = Array.from(new Set(activeSubs.map((s: any) => s.product_name).filter(Boolean)));

    // Pick a representative Stripe customer (prefer one with active subs, else one with name populated)
    const stripeCustomer =
      allStripeCusts.find((c) => (subsByCustomer.get(c.id) ?? []).some((s: any) => s.status === "active")) ??
      allStripeCusts.find((c) => c.name) ??
      allStripeCusts[0] ??
      null;
    const custId = stripeCustomer?.id ?? null;

    // LTV: sum across all dupe customer records
    let ltvTotal = 0;
    let ltvLast = "";
    for (const c of allStripeCusts) {
      const inv = invTotalByCustomer.get(c.id);
      if (inv) {
        ltvTotal += inv.total;
        if (inv.last > ltvLast) ltvLast = inv.last;
      }
    }
    const invData = { total: ltvTotal, last: ltvLast };

    const spfAmount = parseMoney(r.spfAmount);
    const ceoAmount = parseMoney(r.ceoAmount);
    const eliteAmount = parseMoney(r.eliteAmount);
    const monthlyTotal = parseMoney(r.monthlyAvg);

    const section = String(r.section ?? "active").toLowerCase();
    let status: MemberStatus = "active";
    if (section === "hold") status = "hold";
    else if (section === "comped") status = "comped";
    else if (section === "cancelled") status = "cancelled";
    else if (section === "offsite") status = "offsite";
    else if (section === "nonpaying") status = "nonpaying";
    const allEmails = Array.from(new Set(emails));

    const addr = stripeCustomer?.address;
    const addrStr = addr
      ? [addr.line1, addr.city, addr.state, addr.postal_code].filter(Boolean).join(", ")
      : masterHit?.address ?? null;

    // Tier display — prefer master list base tier (Mastermind/CEO 1/CEO 2) + add Elite if in elite tab
    const baseTier = masterHit?.tier ?? "Mastermind";
    const tierParts: string[] = [baseTier];
    if (isElite || eliteAmount > 0) tierParts.push("Elite");
    const tierStr = tierParts.join(" + ");
    const primaryCategory: ProgramKey = categoryFromTier(baseTier);

    const row: MemberRow = {
      id: `ps-${nameKey}`,
      name,
      email: allEmails[0] ?? null,
      allEmails,
      phone: stripeCustomer?.phone ?? null,
      gymName: masterHit?.gym_name ?? null,
      tier: tierStr,
      category: primaryCategory,
      status,
      dateJoined: masterHit?.date_joined ?? null,
      canceledDate: null,
      staff: masterHit?.staff ?? null,
      address: addrStr,
      notes: r.notes ?? null,
      spfAmount,
      ceoAmount,
      eliteAmount,
      monthlyTotal: monthlyTotal || (spfAmount + ceoAmount + eliteAmount),
      stripeCustomerId: custId,
      currentMrr: activeSubs.reduce((s, x: any) => s + Number(x.unit_amount ?? 0), 0),
      lastPaidAt: invData?.last ?? null,
      totalPaid: invData?.total ?? 0,
      activeProducts,
    };

    if (status === "active" || status === "comped") {
      activeByCategory[primaryCategory].push(row);
      if (status === "comped") comped.push(row);
    } else if (status === "hold") {
      onHold.push(row);
      activeByCategory[primaryCategory].push(row);
    } else if (status === "cancelled") {
      row.canceledDate = ps.canceled_date ?? null;
      alumniByCategory[primaryCategory].push(row);
    }

    // RECONCILIATION: flag active members whose billing looks broken in Stripe.
    // Skip comped (by design no Stripe), skip hold (expected paused).
    if (status === "active") {
      const hasActiveMMSub = activeMMSubs.length > 0;
      const hasPastDue = pastDueSubs.length > 0;
      const hasAnyStripe = allStripeCusts.length > 0;
      const hasAnyActiveSub = activeSubs.length > 0;

      let reason: string | null = null;
      if (!hasAnyStripe) {
        reason = "No matching Stripe customer — paying off-Stripe or email mismatch";
      } else if (!hasAnyActiveSub && hasPastDue) {
        reason = `Stripe payment failed (past_due on ${pastDueSubs[0].product_name ?? "sub"})`;
      } else if (!hasAnyActiveSub) {
        reason = "Stripe has customer record but no active subscription";
      } else if (!hasActiveMMSub) {
        reason = `Active Stripe sub but on non-Mastermind product: ${activeProducts.join(", ")}`;
      }

      if (reason) {
        needsBillingAttention.push({ ...row, attentionReason: reason });
      }
    }
  }

  // NCA list (separate tab — Payment Schedules doesn't include NCA)
  const ncaNames = new Set<string>();
  for (const nca of ncaRows) {
    const nameKey = normalizeName(nca.name);
    if (!nameKey || ncaNames.has(nameKey)) continue;
    ncaNames.add(nameKey);

    const emails: string[] = [];
    if (nca.email && !nca.email.startsWith("payment-schedule:")) emails.push(nca.email);
    const stripeCustomer = (emails[0] && (custsByEmail.get(emails[0]) ?? [])[0]) || custByName.get(nameKey) || null;
    const custId = stripeCustomer?.id ?? null;
    const custSubs = custId ? (subsByCustomer.get(custId) ?? []) : [];
    const activeSubs = custSubs.filter((s) => s.status === "active");
    const invData = custId ? invTotalByCustomer.get(custId) : null;

    activeByCategory.nca.push({
      id: `nca-${nameKey}`,
      name: nca.name,
      email: emails[0] ?? null,
      allEmails: emails,
      phone: stripeCustomer?.phone ?? null,
      gymName: nca.gym_name ?? null,
      tier: "NCA",
      category: "nca",
      status: "active",
      dateJoined: nca.date_joined ?? null,
      canceledDate: null,
      staff: null,
      address: stripeCustomer?.address
        ? [stripeCustomer.address.line1, stripeCustomer.address.city, stripeCustomer.address.state].filter(Boolean).join(", ")
        : null,
      notes: null,
      spfAmount: 0,
      ceoAmount: 0,
      eliteAmount: 0,
      monthlyTotal: 0,
      stripeCustomerId: custId,
      currentMrr: activeSubs.reduce((s, x: any) => s + Number(x.unit_amount ?? 0), 0),
      lastPaidAt: invData?.last ?? null,
      totalPaid: invData?.total ?? 0,
      activeProducts: activeSubs.map((s: any) => s.product_name).filter(Boolean),
    });
  }

  // Cancelation rows that aren't already in Payment Schedules cancelled section
  const cancelledNames = new Set(
    alumniByCategory.mastermind.concat(alumniByCategory.elite, alumniByCategory.ceo, alumniByCategory.nca)
      .map((r) => normalizeName(r.name))
  );
  for (const c of cancelationRows) {
    const nameKey = normalizeName(c.name);
    if (!nameKey || cancelledNames.has(nameKey)) continue;
    cancelledNames.add(nameKey);
    const emails = c.email && !c.email.startsWith("payment-schedule:") ? [c.email.toLowerCase()] : [];
    const stripeCustomer = emails[0] ? (custsByEmail.get(emails[0]) ?? [])[0] : custByName.get(nameKey);
    const custId = stripeCustomer?.id ?? null;
    const invData = custId ? invTotalByCustomer.get(custId) : null;
    const cat = categoryFromTier(c.tier);
    alumniByCategory[cat].push({
      id: `cancel-${nameKey}`,
      name: c.name,
      email: emails[0] ?? null,
      allEmails: emails,
      phone: stripeCustomer?.phone ?? null,
      gymName: c.gym_name ?? null,
      tier: c.tier ?? null,
      category: cat,
      status: "cancelled",
      dateJoined: c.date_joined ?? null,
      canceledDate: c.canceled_date ?? null,
      staff: null,
      address: null,
      notes: null,
      spfAmount: 0,
      ceoAmount: 0,
      eliteAmount: 0,
      monthlyTotal: 0,
      stripeCustomerId: custId,
      currentMrr: 0,
      lastPaidAt: invData?.last ?? null,
      totalPaid: invData?.total ?? 0,
      activeProducts: [],
    });
  }

  // Sort
  for (const k of Object.keys(activeByCategory) as ProgramKey[]) {
    activeByCategory[k].sort((a, b) => b.monthlyTotal - a.monthlyTotal || (a.name ?? "").localeCompare(b.name ?? ""));
    alumniByCategory[k].sort((a, b) => (b.canceledDate ?? "").localeCompare(a.canceledDate ?? ""));
  }

  // Attrition (from Stripe subs)
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

  // Terminations — use Stripe canceled_at for real-time visibility
  const terminatedMTD: MemberRow[] = [];
  const terminatedYTD: MemberRow[] = [];
  for (const s of subs) {
    if (!s.canceled_at) continue;
    if (s.canceled_at < yearStartIso) continue;
    const cust = customers.find((c) => c.id === s.customer_id);
    const email = cust?.email?.toLowerCase() ?? "";
    const nameKey = normalizeName(cust?.name);
    const masterHit = masterByName.get(nameKey);
    const cat = masterHit ? categoryFromTier(masterHit.tier) : categoryFromTier(s.product_name);
    const row: MemberRow = {
      id: `term-${s.id}`,
      name: masterHit?.name ?? cust?.name ?? null,
      email: cust?.email ?? null,
      allEmails: email ? [email] : [],
      phone: cust?.phone ?? null,
      gymName: masterHit?.gym_name ?? null,
      tier: masterHit?.tier ?? s.product_name ?? null,
      category: cat,
      status: "cancelled",
      dateJoined: masterHit?.date_joined ?? s.created_at ?? null,
      canceledDate: s.canceled_at,
      staff: null,
      address: null,
      notes: null,
      spfAmount: 0,
      ceoAmount: 0,
      eliteAmount: 0,
      monthlyTotal: 0,
      stripeCustomerId: s.customer_id,
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

  // Stats
  const stats: Record<ProgramKey, ProgramStats> = emptyCatRec(() => ({
    activeCount: 0, alumniCount: 0, mrr: 0, avgLTV: 0, avgStayMonths: 0, cohortSize: 0,
  }));
  for (const cat of Object.keys(activeByCategory) as ProgramKey[]) {
    const active = activeByCategory[cat];
    const alumni = alumniByCategory[cat];
    stats[cat].activeCount = active.length;
    stats[cat].alumniCount = alumni.length;
    stats[cat].mrr = active.reduce((s, r) => s + (r.monthlyTotal || r.currentMrr), 0);
    stats[cat].cohortSize = active.length + alumni.length;
    const ltvs = [...active, ...alumni].map((r) => r.totalPaid).filter((v) => v > 0);
    stats[cat].avgLTV = ltvs.length ? ltvs.reduce((s, x) => s + x, 0) / ltvs.length : 0;
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

  // Cross-cuts: count CEO-paying and Elite-paying across all programs
  const totalActiveCEO = paymentSchedRows.filter((ps) => {
    const section = String(ps.raw?.section ?? "").toLowerCase();
    return (section === "active" || section === "comped") && parseMoney(ps.raw?.ceoAmount) > 0;
  }).length;
  const totalActiveElite = paymentSchedRows.filter((ps) => {
    const section = String(ps.raw?.section ?? "").toLowerCase();
    return (section === "active" || section === "comped") && parseMoney(ps.raw?.eliteAmount) > 0;
  }).length;
  const totalActiveAll = paymentSchedRows.filter((ps) => {
    const section = String(ps.raw?.section ?? "").toLowerCase();
    return section === "active" || section === "comped" || section === "hold";
  }).length;

  // Sort billing attention by reason + name
  needsBillingAttention.sort((a, b) => {
    const ra = a.attentionReason.charCodeAt(0);
    const rb = b.attentionReason.charCodeAt(0);
    if (ra !== rb) return ra - rb;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });

  return {
    activeByCategory,
    alumniByCategory,
    onHold,
    comped,
    needsBillingAttention,
    terminatedMTD,
    terminatedYTD,
    stats,
    totalActiveAll,
    totalActiveCEO,
    totalActiveElite,
    attritionMTD: { canceled: canceledMTD, activeStart: activeAtMonthStart, rate: attritionMTDRate },
    attritionYTD: { canceled: totalCanceledYTD, avgActive, monthlyAvgRate: avgMonthlyYTD },
  };
}
