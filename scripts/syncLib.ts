/**
 * Weekly/daily sync library — called by Vercel Cron at /api/sync.
 *
 * Runs the fast, high-value syncs that should refresh regularly:
 *   - Google Sheets (FBU Dashboard: FACEBOOK, BOOKED CALLS, CALL STATUS, SALES)
 *   - SPF MASTER Member List (all tabs → master_members table)
 *   - Stripe subscriptions (current state across all statuses)
 *   - Stripe invoices (last 90 days — catches new payments)
 *   - GHL opportunities (all open deals)
 *
 * Does NOT do:
 *   - Full historical Stripe charges re-pull (run `npm run sync` locally)
 *   - Full 6-year invoice re-pull
 *   - Full GHL contact pagination
 *
 * Total runtime: ~60-180s. Fits Vercel Pro 300s function timeout.
 */

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// ──────────────────────────────────────────────────────────
// GOOGLE SHEETS (inlined from scripts/syncSheets.ts)
// ──────────────────────────────────────────────────────────
const FBU_SHEET_ID = "1zgN_xK2QMRFEA7LgaPMT71X_8JmykL-Pi3UCiaX823Y";
const MASTER_SHEET_ID = "1qSDD3NY6PCRKQr3XkYHHdDz7ybnlsY7-B9IpbM1NmxE";

function parseNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v).replace(/[$,"]/g, "").trim());
  return Number.isFinite(n) ? n : null;
}
function parseDate(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}
function extractEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      String(raw).split(/[,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"))
    )
  );
}

async function fetchSheet(sheetId: string, tab: string, apiKey: string): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}?key=${apiKey}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.values ?? [];
}

async function syncFbuSheets(sb: any, apiKey: string) {
  const now = new Date().toISOString();
  const counts: Record<string, number> = {};

  // FACEBOOK
  {
    const rows = await fetchSheet(FBU_SHEET_ID, "DATA - FACEBOOK", apiKey);
    let n = 0;
    for (const r of rows.slice(1)) {
      const date = parseDate(r[0]);
      if (!date) continue;
      await sb.from("sheet_fb_ads").upsert({
        date,
        spend: parseNum(r[1]),
        lpvs: parseNum(r[9]) as any,
        website_leads: parseNum(r[11]) as any,
        cost_per_lead: parseNum(r[12]),
        raw: r as any,
        synced_at: now,
      });
      n++;
    }
    counts.fb_ads = n;
  }

  // BOOKED CALLS
  {
    const rows = await fetchSheet(FBU_SHEET_ID, "DATA - BOOKED CALLS", apiKey);
    const seen = new Set<string>();
    let n = 0;
    for (const r of rows.slice(1)) {
      const date = parseDate(r[5]) ?? parseDate(r[0]);
      const email = String(r[3] ?? "").toLowerCase().trim();
      const callType = String(r[6] ?? "").trim() || null;
      if (!date || !email) continue;
      const k = `${date}|${email}|${callType ?? ""}`;
      if (seen.has(k)) continue;
      seen.add(k);
      await sb.from("sheet_booked_calls").upsert(
        {
          booked_date: date,
          name: `${r[1] ?? ""} ${r[2] ?? ""}`.trim() || null,
          email,
          call_type: callType,
          booked_status: String(r[7] ?? "").trim() || null,
          raw: r as any,
          synced_at: now,
        },
        { onConflict: "booked_date,email,call_type" }
      );
      n++;
    }
    counts.booked_calls = n;
  }

  // CALL STATUS
  {
    const rows = await fetchSheet(FBU_SHEET_ID, "DATA - CALL STATUS", apiKey);
    const seen = new Set<string>();
    let n = 0;
    for (const r of rows.slice(1)) {
      const date = parseDate(r[5]) ?? parseDate(r[0]);
      const email = String(r[3] ?? "").toLowerCase().trim();
      const callType = String(r[6] ?? "").trim() || null;
      if (!date || !email) continue;
      const k = `${date}|${email}|${callType ?? ""}`;
      if (seen.has(k)) continue;
      seen.add(k);
      await sb.from("sheet_call_status").upsert(
        {
          call_date: date,
          name: `${r[1] ?? ""} ${r[2] ?? ""}`.trim() || null,
          email,
          call_type: callType,
          status: String(r[10] ?? "").trim() || null,
          outcome: String(r[9] ?? "").trim() || null,
          raw: r as any,
          synced_at: now,
        },
        { onConflict: "call_date,email,call_type" }
      );
      n++;
    }
    counts.call_status = n;
  }

  // SALES
  {
    const rows = await fetchSheet(FBU_SHEET_ID, "DATA - SALES", apiKey);
    const seen = new Set<string>();
    let n = 0;
    for (const r of rows.slice(1)) {
      const date = parseDate(r[0]);
      const email = String(r[3] ?? "").toLowerCase().trim();
      const program = String(r[11] ?? "").trim() || null;
      if (!date || !email) continue;
      const k = `${date}|${email}|${program ?? ""}`;
      if (seen.has(k)) continue;
      seen.add(k);
      await sb.from("sheet_sales").upsert(
        {
          sale_date: date,
          name: `${r[1] ?? ""} ${r[2] ?? ""}`.trim() || null,
          email,
          program,
          amount: parseNum(r[12]),
          mrr: parseNum(r[13]),
          raw: r as any,
          synced_at: now,
        },
        { onConflict: "sale_date,email,program" }
      );
      n++;
    }
    counts.sales = n;
  }
  return counts;
}

async function syncMasterMemberSheet(sb: any, apiKey: string) {
  const now = new Date().toISOString();
  await sb.from("master_members").delete().neq("id", 0);
  const counts: Record<string, number> = {};

  const tabs: { tab: string; tier: string | null; emailCol: number; nameCol?: number }[] = [
    { tab: "SPF Master List", tier: null, emailCol: 2 },
    { tab: "Elite", tier: "Elite", emailCol: 1 },
    { tab: "Cancelations", tier: null, emailCol: 2 },
    { tab: "NCA/Payment Schedule", tier: "NCA", emailCol: -1 },
  ];

  // Master List
  {
    const rows = await fetchSheet(MASTER_SHEET_ID, "SPF Master List", apiKey);
    let n = 0;
    for (const r of rows.slice(1)) {
      const emails = extractEmails(r[2]);
      const tier = (r[4] ?? "").trim() || null;
      if (!tier || emails.length === 0) continue;
      for (const email of emails) {
        await sb.from("master_members").upsert(
          {
            email, name: r[0] ?? null, gym_name: r[3] ?? null,
            tier: tier === "Masterming" ? "Mastermind" : tier,
            date_joined: r[5] ?? null, staff: r[6] ?? null, address: r[7] ?? null,
            source_tab: "SPF Master List", canceled_date: null, raw: r as any, synced_at: now,
          },
          { onConflict: "email,source_tab" }
        );
        n++;
      }
    }
    counts["SPF Master List"] = n;
  }

  // Elite
  {
    const rows = await fetchSheet(MASTER_SHEET_ID, "Elite", apiKey);
    let n = 0;
    for (const r of rows.slice(1)) {
      const emails = extractEmails(r[1]);
      if (!r[0] || emails.length === 0) continue;
      for (const email of emails) {
        await sb.from("master_members").upsert(
          {
            email, name: r[0] ?? null, gym_name: null, tier: "Elite",
            date_joined: r[2] ?? null, staff: r[6] ?? null, address: null,
            source_tab: "Elite", canceled_date: null, raw: r as any, synced_at: now,
          },
          { onConflict: "email,source_tab" }
        );
        n++;
      }
    }
    counts["Elite"] = n;
  }

  // Cancelations
  {
    const rows = await fetchSheet(MASTER_SHEET_ID, "Cancelations", apiKey);
    let n = 0;
    for (const r of rows.slice(1)) {
      const emails = extractEmails(r[2]);
      const tier = (r[4] ?? "").trim() || null;
      if (!tier || emails.length === 0) continue;
      for (const email of emails) {
        await sb.from("master_members").upsert(
          {
            email, name: r[0] ?? null, gym_name: r[3] ?? null,
            tier: tier === "Masterming" ? "Mastermind" : tier,
            date_joined: r[5] ?? null, staff: null, address: null,
            source_tab: "Cancelations", canceled_date: r[1] ?? null, raw: r as any, synced_at: now,
          },
          { onConflict: "email,source_tab" }
        );
        n++;
      }
    }
    counts["Cancelations"] = n;
  }

  // NCA
  try {
    const rows = await fetchSheet(MASTER_SHEET_ID, "NCA/Payment Schedule", apiKey);
    const header = rows[0] ?? [];
    const emailIdx = header.findIndex((h: string) => /email/i.test(String(h)));
    const nameIdx = header.findIndex((h: string) => /member|name/i.test(String(h)));
    let n = 0;
    if (emailIdx >= 0) {
      for (const r of rows.slice(1)) {
        const emails = extractEmails(r[emailIdx]);
        if (emails.length === 0) continue;
        for (const email of emails) {
          await sb.from("master_members").upsert(
            {
              email, name: nameIdx >= 0 ? r[nameIdx] : null, gym_name: null, tier: "NCA",
              date_joined: null, staff: null, address: null,
              source_tab: "NCA/Payment Schedule", canceled_date: null, raw: r as any, synced_at: now,
            },
            { onConflict: "email,source_tab" }
          );
          n++;
        }
      }
    }
    counts["NCA"] = n;
  } catch (e: any) {
    counts["NCA"] = 0;
  }

  // Payment Schedules — source of truth for active/hold/comped/cancelled
  {
    const rows = await fetchSheet(MASTER_SHEET_ID, "SPF Payment Schedules", apiKey);
    let section = "active";
    let n = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const name = (r[0] ?? "").toString().trim();
      const al = name.toLowerCase();
      if (al.includes("comped member")) { section = "Comped"; continue; }
      if (al.includes("offsites only")) { section = "Offsite"; continue; }
      if (al.includes("members on hold")) { section = "Hold"; continue; }
      if (al.includes("non-paying") || al.includes("nonpaying")) { section = "NonPaying"; continue; }
      if (al.includes("cancelled member") || al.includes("canceled member")) { section = "Cancelled"; continue; }
      if (!name || al.startsWith("total")) continue;

      const stripeLink = (r[1] ?? "").toString().trim();
      const match = stripeLink.match(/cus_[A-Za-z0-9]+/);
      const stripeCustomerId = match ? match[0] : null;
      const spfAmount = (r[3] ?? "").toString().trim();
      const ceoAmount = (r[4] ?? "").toString().trim();
      const eliteAmount = (r[5] ?? "").toString().trim();
      const monthlyAvg = (r[6] ?? "").toString().trim();
      const notes = (r[8] ?? "").toString().trim();

      const tierParts = ["Mastermind"];
      if (ceoAmount) tierParts.push("CEO");
      if (eliteAmount) tierParts.push("Elite");

      await sb.from("master_members").upsert(
        {
          email: `payment-schedule:${name.toLowerCase().replace(/\s+/g, "-")}`,
          name, gym_name: null, tier: tierParts.join(" + "),
          date_joined: null, staff: null, address: null,
          source_tab: `Payment Schedules · ${section}`,
          canceled_date: section === "Cancelled" ? "cancelled" : null,
          raw: { row: r, stripeLink, stripeCustomerId, spfAmount, ceoAmount, eliteAmount, monthlyAvg, notes, section } as any,
          synced_at: now,
        },
        { onConflict: "email,source_tab" }
      );
      n++;
    }
    counts["Payment Schedules"] = n;
  }

  return counts;
}

// ──────────────────────────────────────────────────────────
// STRIPE — incremental (subscriptions + last-90d invoices)
// ──────────────────────────────────────────────────────────
async function syncStripeIncremental(sb: any, stripe: Stripe) {
  const now = new Date().toISOString();
  const counts: Record<string, number> = { subs: 0, invoices: 0 };

  // Subscriptions — all statuses, full re-pull (small volume)
  for (const status of ["active", "canceled", "past_due", "unpaid", "trialing", "paused", "incomplete"] as const) {
    for await (const s of stripe.subscriptions.list({ status, limit: 100 })) {
      const item = s.items.data[0];
      const price = item?.price;
      const productId = typeof price?.product === "string" ? price.product : price?.product?.id;
      let productName: string | null = null;
      if (productId) {
        const { data } = await sb.from("stripe_products").select("name").eq("id", productId).maybeSingle();
        productName = data?.name ?? null;
      }
      await sb.from("stripe_subscriptions").upsert({
        id: s.id,
        customer_id: typeof s.customer === "string" ? s.customer : s.customer.id,
        status: s.status,
        price_id: price?.id ?? null,
        product_id: productId ?? null,
        product_name: productName,
        unit_amount: price?.unit_amount ? price.unit_amount / 100 : null,
        interval: price?.recurring?.interval ?? null,
        created_at: new Date(s.created * 1000).toISOString(),
        canceled_at: s.canceled_at ? new Date(s.canceled_at * 1000).toISOString() : null,
        cancellation_reason: s.cancellation_details?.reason ?? null,
        raw: s as any,
        synced_at: now,
      });
      counts.subs++;
    }
  }

  // Invoices — last 90 days (catches payment status changes)
  const cutoff = Math.floor((Date.now() - 90 * 86400000) / 1000);
  for await (const inv of stripe.invoices.list({ limit: 100, created: { gte: cutoff } })) {
    await sb.from("stripe_invoices").upsert({
      id: inv.id,
      customer_id: typeof inv.customer === "string" ? inv.customer : inv.customer?.id,
      subscription_id: (inv as any).subscription ?? null,
      amount_paid: inv.amount_paid ? inv.amount_paid / 100 : null,
      status: inv.status,
      paid_at: (inv as any).status_transitions?.paid_at ? new Date((inv as any).status_transitions.paid_at * 1000).toISOString() : null,
      created_at: new Date(inv.created * 1000).toISOString(),
      lines: inv.lines as any,
      raw: inv as any,
      synced_at: now,
    });
    counts.invoices++;
  }

  return counts;
}

// ──────────────────────────────────────────────────────────
// GHL — current state
// ──────────────────────────────────────────────────────────
async function syncGhl(sb: any) {
  const GHL_TOKEN = env("GHL_PRIVATE_TOKEN");
  const GHL_LOC = env("GHL_LOCATION_ID");
  const headers = { Authorization: `Bearer ${GHL_TOKEN}`, Version: "2021-07-28", Accept: "application/json" };
  const now = new Date().toISOString();
  const counts: Record<string, number> = { opps: 0, appts: 0 };

  // Pipelines → stage name lookup
  const pipelines: any = await fetch(
    `https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${GHL_LOC}`,
    { headers }
  ).then((r) => r.json());
  const stageMap = new Map<string, { pipelineName: string; stageName: string }>();
  for (const p of pipelines.pipelines ?? []) {
    for (const s of p.stages ?? []) stageMap.set(s.id, { pipelineName: p.name, stageName: s.name });
  }

  // Opportunities (open deals)
  const oppsResp: any = await fetch(
    `https://services.leadconnectorhq.com/opportunities/search?location_id=${GHL_LOC}&limit=100`,
    { headers }
  ).then((r) => r.json());
  for (const o of oppsResp.opportunities ?? []) {
    const stage = stageMap.get(o.pipelineStageId) ?? { pipelineName: null, stageName: null };
    await sb.from("ghl_opportunities").upsert({
      id: o.id,
      contact_id: o.contactId,
      pipeline_id: o.pipelineId,
      pipeline_name: stage.pipelineName,
      stage_id: o.pipelineStageId,
      stage_name: stage.stageName,
      status: o.status,
      monetary_value: o.monetaryValue,
      source: o.source,
      name: o.name,
      last_stage_change_at: o.lastStageChangeAt,
      last_status_change_at: o.lastStatusChangeAt,
      created_at: o.createdAt,
      raw: o,
      synced_at: now,
    });
    counts.opps++;
  }

  // Appointments (last 30d + next 30d)
  try {
    const cals = await fetch(`https://services.leadconnectorhq.com/calendars/?locationId=${GHL_LOC}`, { headers }).then((r) => r.json());
    const startMs = Date.now() - 30 * 86400000;
    const endMs = Date.now() + 30 * 86400000;
    for (const cal of cals.calendars ?? []) {
      if (!cal.isActive) continue;
      const url = `https://services.leadconnectorhq.com/calendars/events?locationId=${GHL_LOC}&calendarId=${cal.id}&startTime=${startMs}&endTime=${endMs}`;
      try {
        const data: any = await fetch(url, { headers }).then((r) => r.json());
        for (const e of data.events ?? []) {
          await sb.from("ghl_appointments").upsert({
            id: e.id, calendar_id: cal.id, calendar_name: cal.name,
            contact_id: e.contactId, title: e.title, status: e.appointmentStatus,
            start_time: e.startTime, end_time: e.endTime, raw: e, synced_at: now,
          });
          counts.appts++;
        }
      } catch {}
    }
  } catch {}

  return counts;
}

// ──────────────────────────────────────────────────────────
// Orchestrator
// ──────────────────────────────────────────────────────────
export async function syncAll() {
  const start = Date.now();
  const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const stripe = new Stripe(env("STRIPE_SECRET_KEY"), { apiVersion: "2025-01-27.acacia" as any });
  const apiKey = env("GOOGLE_SHEETS_API_KEY");

  const results: Record<string, any> = {};
  try {
    results.sheets = await syncFbuSheets(sb, apiKey);
  } catch (e: any) { results.sheets_error = e.message; }

  try {
    results.master = await syncMasterMemberSheet(sb, apiKey);
  } catch (e: any) { results.master_error = e.message; }

  try {
    results.stripe = await syncStripeIncremental(sb, stripe);
  } catch (e: any) { results.stripe_error = e.message; }

  try {
    results.ghl = await syncGhl(sb);
  } catch (e: any) { results.ghl_error = e.message; }

  const elapsedMs = Date.now() - start;
  await sb.from("sync_runs").insert({
    source: "cron",
    started_at: new Date(start).toISOString(),
    completed_at: new Date().toISOString(),
    records_synced: 0,
    status: Object.keys(results).some((k) => k.endsWith("_error")) ? "failed" : "success",
    error_message: Object.entries(results).filter(([k]) => k.endsWith("_error")).map(([k, v]) => `${k}:${v}`).join("; ").slice(0, 500) || null,
  });

  return { ok: true, elapsedMs, results };
}
