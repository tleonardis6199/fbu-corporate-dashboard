/**
 * Sync the SPF MASTER Member List Google Sheet → master_members table.
 * Source: https://docs.google.com/spreadsheets/d/1qSDD3NY6PCRKQr3XkYHHdDz7ybnlsY7-B9IpbM1NmxE
 *
 * Authoritative tier categorization. Overrides Stripe product-based guessing.
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
config({ path: ".env" });

const SHEET_ID = "1qSDD3NY6PCRKQr3XkYHHdDz7ybnlsY7-B9IpbM1NmxE";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function fetchTab(tab: string): Promise<string[][]> {
  const apiKey = getEnv("GOOGLE_SHEETS_API_KEY");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tab)}?key=${apiKey}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.values ?? [];
}

function extractEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  // Split by comma or semicolon, normalize, dedupe
  return Array.from(
    new Set(
      String(raw)
        .split(/[,;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@"))
    )
  );
}

function normalizeTier(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (t === "masterming") return "Mastermind"; // fix typo in source
  if (t === "mastermind") return "Mastermind";
  if (t === "ceo 1") return "CEO 1";
  if (t === "ceo 2") return "CEO 2";
  if (t.startsWith("ceo")) return "CEO";
  return raw.trim();
}

export async function syncMasterList() {
  const sb = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const now = new Date().toISOString();

  // Clear and reload (sheet is small enough to just replace)
  await sb.from("master_members").delete().neq("id", 0);

  let totalInserted = 0;

  // 1. SPF Master List — active members with Tier
  {
    const rows = await fetchTab("SPF Master List");
    const [_header, ...body] = rows;
    let n = 0;
    for (const r of body) {
      const emails = extractEmails(r[2]);
      const tier = normalizeTier(r[4]);
      if (!tier || emails.length === 0) continue;
      for (const email of emails) {
        await sb.from("master_members").upsert(
          {
            email,
            name: r[0] ?? null,
            gym_name: r[3] ?? null,
            tier,
            date_joined: r[5] ?? null,
            staff: r[6] ?? null,
            address: r[7] ?? null,
            source_tab: "SPF Master List",
            canceled_date: null,
            raw: r as any,
            synced_at: now,
          },
          { onConflict: "email,source_tab" }
        );
        n++;
      }
    }
    console.log(`✓ SPF Master List: ${n} rows`);
    totalInserted += n;
  }

  // 2. Elite
  {
    const rows = await fetchTab("Elite");
    const [_header, ...body] = rows;
    let n = 0;
    for (const r of body) {
      const emails = extractEmails(r[1]);
      if (!r[0] || emails.length === 0) continue;
      for (const email of emails) {
        await sb.from("master_members").upsert(
          {
            email,
            name: r[0] ?? null,
            gym_name: null,
            tier: "Elite",
            date_joined: r[2] ?? null,
            staff: r[6] ?? null,
            address: null,
            source_tab: "Elite",
            canceled_date: null,
            raw: r as any,
            synced_at: now,
          },
          { onConflict: "email,source_tab" }
        );
        n++;
      }
    }
    console.log(`✓ Elite: ${n} rows`);
    totalInserted += n;
  }

  // 3. Cancelations
  {
    const rows = await fetchTab("Cancelations");
    const [_header, ...body] = rows;
    let n = 0;
    for (const r of body) {
      const emails = extractEmails(r[2]);
      const tier = normalizeTier(r[4]);
      if (!tier || emails.length === 0) continue;
      for (const email of emails) {
        await sb.from("master_members").upsert(
          {
            email,
            name: r[0] ?? null,
            gym_name: r[3] ?? null,
            tier,
            date_joined: r[5] ?? null,
            staff: null,
            address: null,
            source_tab: "Cancelations",
            canceled_date: r[1] ?? null,
            raw: r as any,
            synced_at: now,
          },
          { onConflict: "email,source_tab" }
        );
        n++;
      }
    }
    console.log(`✓ Cancelations: ${n} rows`);
    totalInserted += n;
  }

  // 4. NCA (structure unknown — try Member in col A, Email somewhere)
  try {
    const rows = await fetchTab("NCA/Payment Schedule");
    const [header, ...body] = rows;
    // Find email column by header
    const emailColIdx = header.findIndex((h: string) => /email/i.test(String(h)));
    const nameColIdx = header.findIndex((h: string) => /member|name/i.test(String(h)));
    let n = 0;
    if (emailColIdx >= 0) {
      for (const r of body) {
        const emails = extractEmails(r[emailColIdx]);
        if (emails.length === 0) continue;
        for (const email of emails) {
          await sb.from("master_members").upsert(
            {
              email,
              name: nameColIdx >= 0 ? r[nameColIdx] : null,
              gym_name: null,
              tier: "NCA",
              date_joined: null,
              staff: null,
              address: null,
              source_tab: "NCA/Payment Schedule",
              canceled_date: null,
              raw: r as any,
              synced_at: now,
            },
            { onConflict: "email,source_tab" }
          );
          n++;
        }
      }
    }
    console.log(`✓ NCA: ${n} rows`);
    totalInserted += n;
  } catch (e: any) {
    console.warn(`NCA skipped: ${e.message}`);
  }

  // 5. SPF Payment Schedules — the authoritative "who is paying and in what status" source
  {
    const rows = await fetchTab("SPF Payment Schedules");
    let section: string = "active";
    let n = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const name = (r[0] ?? "").trim();
      const al = name.toLowerCase();
      // Section markers
      if (al.includes("comped member")) { section = "Comped"; continue; }
      if (al.includes("offsites only")) { section = "Offsite"; continue; }
      if (al.includes("members on hold")) { section = "Hold"; continue; }
      if (al.includes("non-paying") || al.includes("nonpaying")) { section = "NonPaying"; continue; }
      if (al.includes("cancelled member") || al.includes("canceled member")) { section = "Cancelled"; continue; }
      if (!name || al.startsWith("total")) continue;

      const spfAmount = (r[3] ?? "").toString().trim();
      const ceoAmount = (r[4] ?? "").toString().trim();
      const eliteAmount = (r[5] ?? "").toString().trim();
      const monthlyAvg = (r[6] ?? "").toString().trim();
      const notes = (r[8] ?? "").toString().trim();

      // Derive a tier summary: Mastermind + CEO (if any) + Elite (if any)
      const tiers: string[] = ["Mastermind"];
      if (ceoAmount) tiers.push("CEO");
      if (eliteAmount) tiers.push("Elite");
      const tierStr = tiers.join(" + ");

      // Use name as the synthetic key (no email in this tab)
      await sb.from("master_members").upsert(
        {
          email: `payment-schedule:${name.toLowerCase().replace(/\s+/g, "-")}`, // synthetic key
          name,
          gym_name: null,
          tier: tierStr,
          date_joined: null,
          staff: null,
          address: null,
          source_tab: `Payment Schedules · ${section}`,
          canceled_date: section === "Cancelled" ? "cancelled" : null,
          raw: {
            row: r,
            spfAmount,
            ceoAmount,
            eliteAmount,
            monthlyAvg,
            notes,
            section,
          } as any,
          synced_at: now,
        },
        { onConflict: "email,source_tab" }
      );
      n++;
    }
    console.log(`✓ SPF Payment Schedules: ${n} rows`);
    totalInserted += n;
  }

  console.log(`\nTotal: ${totalInserted} member records across all tabs`);
  return { totalInserted };
}

if (require.main === module) {
  syncMasterList()
    .then(() => console.log("Master list sync complete"))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
