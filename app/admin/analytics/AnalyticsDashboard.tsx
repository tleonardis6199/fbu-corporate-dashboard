"use client";

import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, KPI, SectionHeader } from "@/components/Card";

type Invoice = { amount_paid: number | null; paid_at: string | null; subscription_id: string | null };
type Subscription = {
  id: string;
  product_name: string | null;
  customer_id: string | null;
  status: string | null;
  created_at: string | null;
  canceled_at: string | null;
  unit_amount: number | null;
};

type Granularity = "month" | "quarter" | "year";

function bucket(d: Date, g: Granularity): string {
  const y = d.getFullYear();
  if (g === "year") return String(y);
  if (g === "quarter") {
    const q = Math.floor(d.getMonth() / 3) + 1;
    return `${y} Q${q}`;
  }
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function AnalyticsDashboard({ invoices, subscriptions }: { invoices: Invoice[]; subscriptions: Subscription[] }) {
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [program, setProgram] = useState<"All" | "Mastermind" | "NCA">("All");

  const subByProduct = (prog: typeof program, sub: Subscription) => {
    const name = (sub.product_name ?? "").toLowerCase();
    if (prog === "All") return true;
    if (prog === "Mastermind") return name.includes("mastermind");
    if (prog === "NCA") return name.includes("new client academy") || name.includes("nca");
    return true;
  };

  // Revenue time series
  const revenueSeries = useMemo(() => {
    const map: Map<string, { bucket: string; revenue: number; invoices: number }> = new Map();
    // Build subscription -> product lookup
    const subProduct = new Map<string, string>();
    for (const s of subscriptions) {
      if (s.id) subProduct.set(s.id, s.product_name ?? "");
    }
    for (const inv of invoices) {
      if (!inv.paid_at) continue;
      const prod = (subProduct.get(inv.subscription_id ?? "") ?? "").toLowerCase();
      if (program === "Mastermind" && !prod.includes("mastermind")) continue;
      if (program === "NCA" && !(prod.includes("new client academy") || prod.includes("nca"))) continue;
      const key = bucket(new Date(inv.paid_at), granularity);
      const cur = map.get(key) ?? { bucket: key, revenue: 0, invoices: 0 };
      cur.revenue += Number(inv.amount_paid ?? 0);
      cur.invoices += 1;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => (a.bucket < b.bucket ? -1 : 1));
  }, [invoices, subscriptions, granularity, program]);

  // Active subs right now
  const activeSubs = useMemo(() => {
    return subscriptions.filter((s) => s.status === "active" && subByProduct(program, s));
  }, [subscriptions, program]);

  const activeMastermind = subscriptions.filter((s) => s.status === "active" && (s.product_name ?? "").toLowerCase().includes("mastermind"));
  const activeNCA = subscriptions.filter((s) => s.status === "active" && /new client academy|nca/i.test(s.product_name ?? ""));

  const mrrMastermind = activeMastermind.reduce((s, x) => s + Number(x.unit_amount ?? 0), 0);
  const mrrNCA = activeNCA.reduce((s, x) => s + Number(x.unit_amount ?? 0), 0);

  // LTV by customer (sum of all paid invoices per customer, filtered by program)
  const ltvByCustomer = useMemo(() => {
    const subProduct = new Map<string, string>();
    const subCustomer = new Map<string, string>();
    for (const s of subscriptions) {
      if (s.id) {
        subProduct.set(s.id, s.product_name ?? "");
        if (s.customer_id) subCustomer.set(s.id, s.customer_id);
      }
    }
    const ltvMap: Map<string, number> = new Map();
    for (const inv of invoices) {
      if (!inv.subscription_id) continue;
      const prod = (subProduct.get(inv.subscription_id) ?? "").toLowerCase();
      if (program === "Mastermind" && !prod.includes("mastermind")) continue;
      if (program === "NCA" && !(prod.includes("new client academy") || prod.includes("nca"))) continue;
      const cust = subCustomer.get(inv.subscription_id);
      if (!cust) continue;
      ltvMap.set(cust, (ltvMap.get(cust) ?? 0) + Number(inv.amount_paid ?? 0));
    }
    const vals = Array.from(ltvMap.values());
    const total = vals.reduce((s, x) => s + x, 0);
    const avg = vals.length ? total / vals.length : 0;
    const max = vals.length ? Math.max(...vals) : 0;
    return { total, avg, max, customerCount: vals.length };
  }, [invoices, subscriptions, program]);

  // Attrition: count canceled subs per bucket
  const attritionSeries = useMemo(() => {
    const map: Map<string, { bucket: string; canceled: number }> = new Map();
    for (const s of subscriptions) {
      if (!s.canceled_at) continue;
      if (program === "Mastermind" && !(s.product_name ?? "").toLowerCase().includes("mastermind")) continue;
      if (program === "NCA" && !/new client academy|nca/i.test(s.product_name ?? "")) continue;
      const key = bucket(new Date(s.canceled_at), granularity);
      const cur = map.get(key) ?? { bucket: key, canceled: 0 };
      cur.canceled += 1;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => (a.bucket < b.bucket ? -1 : 1));
  }, [subscriptions, granularity, program]);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <Card>
        <div className="flex gap-4 flex-wrap items-center">
          <div>
            <label className="block text-xs text-muted mb-1 uppercase tracking-wide">Granularity</label>
            <select
              value={granularity}
              onChange={(e) => setGranularity(e.target.value as Granularity)}
              className="bg-bg border border-border text-text px-3 py-2 rounded text-sm"
            >
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
              <option value="year">Year</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1 uppercase tracking-wide">Program</label>
            <select
              value={program}
              onChange={(e) => setProgram(e.target.value as any)}
              className="bg-bg border border-border text-text px-3 py-2 rounded text-sm"
            >
              <option value="All">All programs</option>
              <option value="Mastermind">Mastermind only</option>
              <option value="NCA">NCA only</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Program snapshot */}
      <div className="flex gap-3 flex-wrap">
        <KPI label="Active Mastermind" value={activeMastermind.length} sub={`$${mrrMastermind.toLocaleString()}/mo MRR`} color="#a855f7" />
        <KPI label="Active NCA" value={activeNCA.length} sub={`$${mrrNCA.toLocaleString()}/mo MRR`} color="#eab308" />
        <KPI label={`${program} LTV avg`} value={`$${Math.round(ltvByCustomer.avg).toLocaleString()}`} sub={`${ltvByCustomer.customerCount} customers · max $${Math.round(ltvByCustomer.max).toLocaleString()}`} color="#22c55e" />
        <KPI label={`${program} LTV total`} value={`$${Math.round(ltvByCustomer.total).toLocaleString()}`} sub="paid invoices sum" color="#22c55e" />
      </div>

      {/* Revenue chart */}
      <div>
        <SectionHeader accent="#22c55e" title={`Revenue by ${granularity}`} subtitle={`${program}`} />
        <Card>
          {revenueSeries.length === 0 ? (
            <div className="p-8 text-dim text-center text-sm">No data yet. Run sync.</div>
          ) : (
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <BarChart data={revenueSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="bucket" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 }}
                    formatter={(v: any) => [`$${Number(v).toLocaleString()}`, "Revenue"]}
                  />
                  <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                  <Bar dataKey="revenue" fill="#22c55e" name="Revenue" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Attrition chart */}
      <div>
        <SectionHeader accent="#ef4444" title={`Attrition by ${granularity}`} subtitle="Cancelled subscriptions" />
        <Card>
          {attritionSeries.length === 0 ? (
            <div className="p-8 text-dim text-center text-sm">No cancellations recorded.</div>
          ) : (
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={attritionSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="bucket" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={11} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 }}
                  />
                  <Bar dataKey="canceled" fill="#ef4444" name="Cancelled" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
