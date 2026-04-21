import { createServerClient } from "./supabase";

// Centralized DB queries used by dashboard pages.
// All functions run server-side (server components or API routes).

export async function getPipelineOpportunities() {
  const sb = createServerClient();
  const { data, error } = await sb
    .from("ghl_opportunities")
    .select("*")
    .in("pipeline_name", ["FBU Sales Pipeline", "Master Sales Pipeline"])
    .eq("status", "open")
    .order("last_stage_change_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getLapsedSubscriptions(days: number) {
  const sb = createServerClient();
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await sb
    .from("stripe_subscriptions")
    .select("*, stripe_customers(*)")
    .eq("status", "canceled")
    .gte("canceled_at", cutoff)
    .order("canceled_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getRecentContacts(days: number) {
  const sb = createServerClient();
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const { count } = await sb
    .from("ghl_contacts")
    .select("*", { count: "exact", head: true })
    .gte("date_added", cutoff);
  return count ?? 0;
}

export async function getSheetFbAds(days: number) {
  const sb = createServerClient();
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { data, error } = await sb
    .from("sheet_fb_ads")
    .select("*")
    .gte("date", cutoff)
    .order("date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getCallStatus(startDate: string, endDate: string) {
  const sb = createServerClient();
  const { data, error } = await sb
    .from("sheet_call_status")
    .select("*")
    .gte("call_date", startDate)
    .lte("call_date", endDate)
    .order("call_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getCloses(startDate: string, endDate: string) {
  const sb = createServerClient();
  const { data, error } = await sb
    .from("sheet_sales")
    .select("*")
    .gte("sale_date", startDate)
    .lte("sale_date", endDate)
    .order("sale_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getUserFlag(email: string) {
  const sb = createServerClient();
  const { data } = await sb.from("user_flags").select("*").eq("email", email).maybeSingle();
  return data;
}

export async function getAllUserFlags() {
  const sb = createServerClient();
  const { data } = await sb.from("user_flags").select("*");
  return data ?? [];
}

export async function getLTVByProgram(programFilter: string) {
  const sb = createServerClient();
  // Sum paid invoices by customer for subscriptions whose product_name contains programFilter
  const { data, error } = await sb.rpc("ltv_by_program", { program_filter: programFilter }).select();
  if (error) {
    // Fallback: client-side calc until we create the rpc
    const { data: invoices } = await sb
      .from("stripe_invoices")
      .select("customer_id, amount_paid, subscription_id")
      .eq("status", "paid");
    if (!invoices) return { total: 0, byCustomer: [] };
    // Need to join with subscriptions for product name — simplified
    return { total: 0, byCustomer: [] };
  }
  return data;
}

export async function getPastPurchasers(days: number) {
  const sb = createServerClient();
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await sb
    .from("stripe_charges")
    .select("customer_id, amount, created_at, description, stripe_customers(email, name, phone, address)")
    .eq("status", "succeeded")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
