/**
 * Google Sheets → Supabase sync
 * Uses API key (not OAuth / service account) against a link-shared sheet.
 *
 * Tabs synced:
 *   - DATA - FACEBOOK    → sheet_fb_ads
 *   - DATA - BOOKED CALLS → sheet_booked_calls
 *   - DATA - CALL STATUS  → sheet_call_status
 *   - DATA - SALES        → sheet_sales
 *   - DATA - LEADS        → (skipped — volume too high, not used in current UI)
 */

import { createClient } from "@supabase/supabase-js";

const SHEET_ID = "1zgN_xK2QMRFEA7LgaPMT71X_8JmykL-Pi3UCiaX823Y";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function parseNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const cleaned = String(v).replace(/[$,"]/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  // Handle "M/D/YYYY" -> "YYYY-MM-DD"
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Handle ISO-ish "YYYY-MM-DD [HH:MM:SS]"
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

async function fetchTab(tab: string, apiKey: string): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tab)}?key=${apiKey}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.values ?? [];
}

export async function syncSheets() {
  const apiKey = getEnv("GOOGLE_SHEETS_API_KEY");
  const sb = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const now = new Date().toISOString();

  // ---- DATA - FACEBOOK ----
  {
    const rows = await fetchTab("DATA - FACEBOOK", apiKey);
    const [header, ...body] = rows;
    // Expected columns: A=date, B=spend, ... J=lpvs, L=website_leads, M=cost_per_lead
    // Use letter positions from prior Zapier extract
    const col = (row: any[], idx: number) => row?.[idx];
    let count = 0;
    for (const r of body) {
      const date = parseDate(col(r, 0));
      if (!date) continue;
      await sb.from("sheet_fb_ads").upsert({
        date,
        spend: parseNum(col(r, 1)),
        lpvs: parseNum(col(r, 9)) as any,
        website_leads: parseNum(col(r, 11)) as any,
        cost_per_lead: parseNum(col(r, 12)),
        raw: r as any,
        synced_at: now,
      });
      count++;
    }
    console.log(`✓ sheet_fb_ads: ${count}`);
  }

  // ---- DATA - BOOKED CALLS ----
  // Columns: A=Booking Created, B=First, C=Last, D=Email, E=Phone,
  //          F=Appointment Date, G=Calendar, H=Attribution, I=Funnel,
  //          J=Appointment Owner, K=Contact Created
  {
    const rows = await fetchTab("DATA - BOOKED CALLS", apiKey);
    const [header, ...body] = rows;
    let count = 0;
    const seen = new Set<string>();
    for (const r of body) {
      const date = parseDate(r[5]) ?? parseDate(r[0]); // prefer appointment date
      const email = String(r[3] ?? "").toLowerCase().trim();
      const callType = String(r[6] ?? "").trim() || null; // Calendar
      if (!date || !email) continue;
      const key = `${date}|${email}|${callType ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await sb.from("sheet_booked_calls").upsert(
        {
          booked_date: date,
          name: `${r[1] ?? ""} ${r[2] ?? ""}`.trim() || null,
          email,
          call_type: callType,
          booked_status: String(r[7] ?? "").trim() || null, // Attribution
          raw: r as any,
          synced_at: now,
        },
        { onConflict: "booked_date,email,call_type" }
      );
      count++;
    }
    console.log(`✓ sheet_booked_calls: ${count}`);
  }

  // ---- DATA - CALL STATUS ----
  // Columns: A=Status Updated, B=First, C=Last, D=Email, E=Phone,
  //          F=Appointment Date, G=Calendar, H=First Touch, I=Last Touch,
  //          J=UTM, K=STATUS
  {
    const rows = await fetchTab("DATA - CALL STATUS", apiKey);
    const [header, ...body] = rows;
    let count = 0;
    const seen = new Set<string>();
    for (const r of body) {
      const date = parseDate(r[5]) ?? parseDate(r[0]); // use appointment date
      const email = String(r[3] ?? "").toLowerCase().trim();
      const callType = String(r[6] ?? "").trim() || null; // Calendar
      if (!date || !email) continue;
      const key = `${date}|${email}|${callType ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await sb.from("sheet_call_status").upsert(
        {
          call_date: date,
          name: `${r[1] ?? ""} ${r[2] ?? ""}`.trim() || null,
          email,
          call_type: callType,
          status: String(r[10] ?? "").trim() || null, // STATUS column K
          outcome: String(r[9] ?? "").trim() || null, // UTM column J
          raw: r as any,
          synced_at: now,
        },
        { onConflict: "call_date,email,call_type" }
      );
      count++;
    }
    console.log(`✓ sheet_call_status: ${count}`);
  }

  // ---- DATA - SALES ----
  // Headers: date, first, last, email, ..., program, price, mrr
  {
    const rows = await fetchTab("DATA - SALES", apiKey);
    const [header, ...body] = rows;
    let count = 0;
    const seen = new Set<string>();
    for (const r of body) {
      const date = parseDate(r[0]);
      const email = String(r[3] ?? "").toLowerCase().trim();
      const program = String(r[11] ?? "").trim() || null;
      if (!date || !email) continue;
      const key = `${date}|${email}|${program ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
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
      count++;
    }
    console.log(`✓ sheet_sales: ${count}`);
  }

  return { ok: true };
}

// Allow running directly: npm run sync:sheets
if (require.main === module) {
  const { config } = require("dotenv");
  config({ path: ".env.local" });
  syncSheets()
    .then(() => console.log("Sheets sync complete"))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
