# FBU Corporate Dashboard

Live sales + pipeline dashboard. Pulls from Stripe, GoHighLevel, Google Sheets, and Google Calendar into Supabase, renders on Vercel.

**URL:** `fbu-corporate-dashboard.vercel.app/admin` (password-gated)

## Architecture

```
Stripe  ┐
GHL     ├──→  scripts/sync.ts  ──→  Supabase  ──→  Next.js (Vercel)  ──→  You + boss
Sheets  │
GCal    ┘
```

## Local development

```bash
cp .env.local.example .env.local
# Fill in the tokens
npm install
npm run sync   # Initial data seed (5-15 min)
npm run dev    # http://localhost:3000
```

## Deploy

Vercel auto-deploys on push to `main`. Required env vars (set in Vercel UI):

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase client |
| `DASHBOARD_PASSWORD` | Password gate for `/admin` |
| `STRIPE_SECRET_KEY` | Stripe restricted key (read-only subs/customers/invoices/charges) |
| `GHL_PRIVATE_TOKEN` | GHL Private Integration token |
| `GHL_LOCATION_ID` | GHL location ID |
| `SYNC_SECRET` | Token protecting `/api/sync` cron endpoint |

## Tabs

- **This Week** — L7 KPIs, hot list, report-week calls with show/no-show/cancelled pills
- **MTD + L30** — Month-to-date funnel, FB ads, closes
- **Past Purchasers** — 24 months of customers sorted by LTV
- **Follow-Up** — Lapsed 30d/60d, no-shows, cancelled calls, rescheduled, with editable gym/address and follow-up toggle
- **Analytics** — YoY/QoQ/MoM revenue + attrition since 2020, LTV per program

## Sync cadence

- **Vercel Cron:** weekly Monday 10 UTC → `/api/sync?token=$SYNC_SECRET`
- **Manual:** `npm run sync` locally, or call the `/api/sync` URL with `?token=` in your browser

## Security

- Service role key stored only in Vercel env vars
- Restricted Stripe key (read-only scopes)
- Cookie-based auth for `/admin`, HTTP-only
