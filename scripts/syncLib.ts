/**
 * Reusable sync library — imported by /api/sync for Vercel Cron.
 * Same logic as scripts/sync.ts but exposed as syncAll().
 */

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export async function syncAll() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const STRIPE_KEY = process.env.STRIPE_SECRET_KEY!;
  const GHL_TOKEN = process.env.GHL_PRIVATE_TOKEN!;
  const GHL_LOC = process.env.GHL_LOCATION_ID!;

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2025-01-27.acacia" as any });

  // Minimal Vercel-safe sync — only the recent windows to stay under 5-min timeout.
  // For full historical seed, run `npm run sync` locally.

  const ghlHeaders = {
    Authorization: `Bearer ${GHL_TOKEN}`,
    Version: "2021-07-28",
    Accept: "application/json",
  };

  const now = new Date().toISOString();

  // --- Stripe: recent changes ---
  // Subscriptions (all — for live status)
  let subCount = 0;
  for (const status of ["active", "canceled", "past_due"] as const) {
    for await (const s of stripe.subscriptions.list({ status, limit: 100 })) {
      const item = s.items.data[0];
      const price = item?.price;
      const productId = typeof price?.product === "string" ? price.product : price?.product?.id;
      await sb.from("stripe_subscriptions").upsert({
        id: s.id,
        customer_id: typeof s.customer === "string" ? s.customer : s.customer.id,
        status: s.status,
        price_id: price?.id ?? null,
        product_id: productId ?? null,
        unit_amount: price?.unit_amount ? price.unit_amount / 100 : null,
        interval: price?.recurring?.interval ?? null,
        created_at: new Date(s.created * 1000).toISOString(),
        canceled_at: s.canceled_at ? new Date(s.canceled_at * 1000).toISOString() : null,
        cancellation_reason: s.cancellation_details?.reason ?? null,
        raw: s as any,
        synced_at: now,
      });
      subCount++;
    }
  }

  // --- GHL: opportunities ---
  const pipelines: any = await fetch(
    `https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${GHL_LOC}`,
    { headers: ghlHeaders }
  ).then((r) => r.json());
  const stageMap = new Map<string, { pipelineName: string; stageName: string }>();
  for (const p of pipelines.pipelines ?? []) {
    for (const s of p.stages ?? []) {
      stageMap.set(s.id, { pipelineName: p.name, stageName: s.name });
    }
  }

  let oppCount = 0;
  const oppsResp: any = await fetch(
    `https://services.leadconnectorhq.com/opportunities/search?location_id=${GHL_LOC}&limit=100`,
    { headers: ghlHeaders }
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
    oppCount++;
  }

  return { subCount, oppCount };
}
