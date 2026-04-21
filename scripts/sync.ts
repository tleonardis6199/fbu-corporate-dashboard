/**
 * Data sync: Stripe + GHL → Supabase
 *
 * Run locally:     npm run sync
 * Run on Vercel:   hit /api/sync with ?token=$SYNC_SECRET (Cron does this weekly)
 *
 * Pulls:
 *   - Stripe customers, products, prices, subscriptions (all), charges (last 2y), invoices (last 6y, paid only)
 *   - GHL contacts (last 60d for volume; full pull every Nth run), opportunities (all open + recent closed), appointments (last 30d)
 *
 * Idempotent: upserts by primary key. Re-running is safe.
 */

import { config } from "dotenv";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Load .env.local explicitly (dotenv defaults to .env only)
config({ path: ".env.local" });
config({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY!;
const GHL_TOKEN = process.env.GHL_PRIVATE_TOKEN!;
const GHL_LOC = process.env.GHL_LOCATION_ID!;

if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Supabase env vars missing");
if (!STRIPE_KEY) throw new Error("STRIPE_SECRET_KEY missing");
if (!GHL_TOKEN || !GHL_LOC) throw new Error("GHL env vars missing");

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2025-01-27.acacia" as any });

const ghlHeaders = {
  Authorization: `Bearer ${GHL_TOKEN}`,
  Version: "2021-07-28",
  Accept: "application/json",
};

async function logSyncRun(source: string, start: Date, records: number, status: "success" | "failed", err?: string) {
  await sb.from("sync_runs").insert({
    source,
    started_at: start.toISOString(),
    completed_at: new Date().toISOString(),
    records_synced: records,
    status,
    error_message: err?.slice(0, 500),
  });
}

// ----------------------------------------------------------------
// STRIPE
// ----------------------------------------------------------------

async function syncStripeCustomers() {
  const start = new Date();
  let count = 0;
  try {
    for await (const c of stripe.customers.list({ limit: 100 })) {
      await sb.from("stripe_customers").upsert({
        id: c.id,
        email: c.email,
        name: c.name,
        phone: c.phone,
        address: c.address as any,
        metadata: c.metadata as any,
        created_at: new Date(c.created * 1000).toISOString(),
        raw: c as any,
        synced_at: new Date().toISOString(),
      });
      count++;
      if (count % 500 === 0) console.log(`  customers: ${count}`);
    }
    await logSyncRun("stripe_customers", start, count, "success");
    console.log(`✓ ${count} Stripe customers`);
  } catch (e: any) {
    await logSyncRun("stripe_customers", start, count, "failed", e.message);
    throw e;
  }
}

async function syncStripeProductsPrices() {
  const start = new Date();
  let pc = 0, prc = 0;
  for await (const p of stripe.products.list({ limit: 100, active: undefined })) {
    await sb.from("stripe_products").upsert({
      id: p.id, name: p.name, active: p.active, raw: p as any, synced_at: new Date().toISOString(),
    });
    pc++;
  }
  for await (const pr of stripe.prices.list({ limit: 100, active: undefined })) {
    await sb.from("stripe_prices").upsert({
      id: pr.id,
      product_id: typeof pr.product === "string" ? pr.product : pr.product?.id,
      unit_amount: pr.unit_amount ? pr.unit_amount / 100 : null,
      currency: pr.currency,
      interval: pr.recurring?.interval ?? null,
      nickname: pr.nickname,
      active: pr.active,
      raw: pr as any,
      synced_at: new Date().toISOString(),
    });
    prc++;
  }
  await logSyncRun("stripe_products_prices", start, pc + prc, "success");
  console.log(`✓ ${pc} products, ${prc} prices`);
}

async function syncStripeSubscriptions() {
  const start = new Date();
  let count = 0;
  // Pull all subscriptions (any status) — needed for historical LTV calc
  for (const status of ["active", "canceled", "past_due", "unpaid", "trialing", "paused", "incomplete"] as const) {
    for await (const s of stripe.subscriptions.list({ status, limit: 100, expand: ["data.items.data.price"] })) {
      const item = s.items.data[0];
      const price = item?.price;
      const productId = typeof price?.product === "string" ? price.product : price?.product?.id;
      // Fetch product name (cached via upsert above)
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
        current_period_start: (s as any).current_period_start ? new Date((s as any).current_period_start * 1000).toISOString() : null,
        current_period_end: (s as any).current_period_end ? new Date((s as any).current_period_end * 1000).toISOString() : null,
        raw: s as any,
        synced_at: new Date().toISOString(),
      });
      count++;
    }
    console.log(`  subs ${status}: running total ${count}`);
  }
  await logSyncRun("stripe_subscriptions", start, count, "success");
  console.log(`✓ ${count} subscriptions`);
}

async function syncStripeInvoices() {
  const start = new Date();
  // Since 2017-01-01 (Unix epoch)
  const cutoff = Math.floor(new Date("2017-01-01").getTime() / 1000);
  let count = 0;
  for await (const inv of stripe.invoices.list({ limit: 100, created: { gte: cutoff }, status: "paid" })) {
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
      synced_at: new Date().toISOString(),
    });
    count++;
    if (count % 500 === 0) console.log(`  invoices: ${count}`);
  }
  await logSyncRun("stripe_invoices", start, count, "success");
  console.log(`✓ ${count} invoices`);
}

async function syncStripeCharges() {
  const start = new Date();
  // Since 2017-01-01 for full historical LTV attribution
  const cutoff = Math.floor(new Date("2017-01-01").getTime() / 1000);
  let count = 0;
  for await (const ch of stripe.charges.list({ limit: 100, created: { gte: cutoff } })) {
    if (ch.status !== "succeeded") continue;
    await sb.from("stripe_charges").upsert({
      id: ch.id,
      customer_id: typeof ch.customer === "string" ? ch.customer : ch.customer?.id,
      subscription_id: (ch as any).invoice ? null : null, // charge→invoice→subscription; we link via invoice later
      invoice_id: typeof ch.invoice === "string" ? ch.invoice : ch.invoice?.id,
      amount: ch.amount / 100,
      currency: ch.currency,
      status: ch.status,
      description: ch.description,
      created_at: new Date(ch.created * 1000).toISOString(),
      raw: ch as any,
      synced_at: new Date().toISOString(),
    });
    count++;
    if (count % 500 === 0) console.log(`  charges: ${count}`);
  }
  await logSyncRun("stripe_charges", start, count, "success");
  console.log(`✓ ${count} charges`);
}

// ----------------------------------------------------------------
// GHL
// ----------------------------------------------------------------

async function ghlFetch(url: string): Promise<any> {
  const res = await fetch(url, { headers: ghlHeaders });
  if (!res.ok) throw new Error(`GHL ${res.status}: ${await res.text()}`);
  return res.json();
}

async function syncGhlContacts() {
  const start = new Date();
  let count = 0;
  let startAfter = Date.now();
  let startAfterId: string | undefined;
  // Paginate backwards in time — stop after 1 year of history for weekly runs
  const oneYearAgo = Date.now() - 365 * 86400000;
  for (let page = 1; page <= 100; page++) {
    const url = new URL("https://services.leadconnectorhq.com/contacts/");
    url.searchParams.set("locationId", GHL_LOC);
    url.searchParams.set("startAfter", String(startAfter));
    if (startAfterId) url.searchParams.set("startAfterId", startAfterId);
    url.searchParams.set("limit", "100");
    const data = await ghlFetch(url.toString());
    const rows = data.contacts ?? [];
    if (rows.length === 0) break;

    for (const c of rows) {
      await sb.from("ghl_contacts").upsert({
        id: c.id,
        email: c.email,
        first_name: c.firstName,
        last_name: c.lastName,
        company_name: c.companyName,
        phone: c.phone,
        address1: c.address1,
        city: c.city,
        state: c.state,
        postal_code: c.postalCode,
        country: c.country,
        source: c.source,
        tags: c.tags ?? [],
        date_added: c.dateAdded,
        raw: c,
        synced_at: new Date().toISOString(),
      });
      count++;
    }

    const newAfter = data.meta?.startAfter;
    const newId = data.meta?.startAfterId;
    console.log(`  ghl contacts page ${page}: ${rows.length}, cumulative ${count}, oldest ${rows[rows.length - 1]?.dateAdded}`);
    if (!newAfter || (newAfter === startAfter && newId === startAfterId)) break;
    if (newAfter < oneYearAgo) break;
    startAfter = newAfter;
    startAfterId = newId;
  }
  await logSyncRun("ghl_contacts", start, count, "success");
  console.log(`✓ ${count} GHL contacts`);
}

async function syncGhlOpportunities() {
  const start = new Date();
  let count = 0;
  // List pipelines to get stage names
  const pipelines = await ghlFetch(`https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${GHL_LOC}`);
  const stageMap = new Map<string, { pipelineName: string; stageName: string }>();
  for (const p of pipelines.pipelines ?? []) {
    for (const s of p.stages ?? []) {
      stageMap.set(s.id, { pipelineName: p.name, stageName: s.name });
    }
  }

  // Search all open opportunities
  let searchAfter: string | undefined;
  for (let page = 1; page <= 50; page++) {
    const url = new URL("https://services.leadconnectorhq.com/opportunities/search");
    url.searchParams.set("location_id", GHL_LOC);
    url.searchParams.set("limit", "100");
    if (searchAfter) url.searchParams.set("startAfter", searchAfter);
    const data = await ghlFetch(url.toString());
    const rows = data.opportunities ?? [];
    if (rows.length === 0) break;

    for (const o of rows) {
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
        synced_at: new Date().toISOString(),
      });
      count++;
    }
    if (rows.length < 100) break;
    searchAfter = rows[rows.length - 1].id;
  }
  await logSyncRun("ghl_opportunities", start, count, "success");
  console.log(`✓ ${count} GHL opportunities`);
}

async function syncGhlAppointments() {
  const start = new Date();
  let count = 0;
  const cals = await ghlFetch(`https://services.leadconnectorhq.com/calendars/?locationId=${GHL_LOC}`);
  const startMs = Date.now() - 30 * 86400000;
  const endMs = Date.now() + 30 * 86400000;
  for (const cal of cals.calendars ?? []) {
    if (!cal.isActive) continue;
    const url = `https://services.leadconnectorhq.com/calendars/events?locationId=${GHL_LOC}&calendarId=${cal.id}&startTime=${startMs}&endTime=${endMs}`;
    try {
      const data = await ghlFetch(url);
      for (const e of data.events ?? []) {
        await sb.from("ghl_appointments").upsert({
          id: e.id,
          calendar_id: cal.id,
          calendar_name: cal.name,
          contact_id: e.contactId,
          title: e.title,
          status: e.appointmentStatus,
          start_time: e.startTime,
          end_time: e.endTime,
          raw: e,
          synced_at: new Date().toISOString(),
        });
        count++;
      }
    } catch (e) {
      console.warn(`  skip cal ${cal.name}: ${e}`);
    }
  }
  await logSyncRun("ghl_appointments", start, count, "success");
  console.log(`✓ ${count} GHL appointments`);
}

// ----------------------------------------------------------------
// Main
// ----------------------------------------------------------------

async function main() {
  const only = process.argv[2];
  console.log(`Sync starting @ ${new Date().toISOString()}${only ? ` (only: ${only})` : ""}\n`);

  const tasks: Record<string, () => Promise<void>> = {
    "stripe-customers": syncStripeCustomers,
    "stripe-products": syncStripeProductsPrices,
    "stripe-subscriptions": syncStripeSubscriptions,
    "stripe-invoices": syncStripeInvoices,
    "stripe-charges": syncStripeCharges,
    "ghl-contacts": syncGhlContacts,
    "ghl-opportunities": syncGhlOpportunities,
    "ghl-appointments": syncGhlAppointments,
  };

  const order = [
    "stripe-customers",
    "stripe-products",
    "stripe-subscriptions",
    "stripe-invoices",
    "stripe-charges",
    "ghl-contacts",
    "ghl-opportunities",
    "ghl-appointments",
  ];

  for (const key of order) {
    if (only && only !== key) continue;
    console.log(`\n▶ ${key}`);
    try {
      await tasks[key]();
    } catch (e: any) {
      console.error(`✗ ${key}: ${e.message}`);
    }
  }

  console.log(`\nSync complete @ ${new Date().toISOString()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
