"use client";

import { useEffect, useState } from "react";
import { Card, SectionHeader } from "@/components/Card";

type FollowUpRow = {
  email: string | null;
  name: string | null;
  phone: string | null;
  date: string | null;
  context: string;
  amount?: number;
  isMastermind?: boolean;
};

type TabKey = "lapsed30" | "lapsed60" | "noshow" | "cancelled" | "rescheduled";

export default function FollowUpPage() {
  const [tab, setTab] = useState<TabKey>("lapsed30");
  const [data, setData] = useState<Record<TabKey, FollowUpRow[]>>({
    lapsed30: [], lapsed60: [], noshow: [], cancelled: [], rescheduled: [],
  });
  const [flags, setFlags] = useState<Record<string, { follow_up: boolean; gym_name?: string; address_line1?: string }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/followup")
      .then((r) => r.json())
      .then((d) => {
        setData(d.data ?? {});
        setFlags(d.flags ?? {});
        setLoading(false);
      });
  }, []);

  async function toggleFollowup(email: string) {
    const current = flags[email]?.follow_up ?? false;
    const next = !current;
    setFlags((f) => ({ ...f, [email]: { ...(f[email] || {}), follow_up: next } }));
    await fetch("/api/followup/flag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, follow_up: next }),
    });
  }

  async function updateField(email: string, field: "gym_name" | "address_line1", value: string) {
    setFlags((f) => ({ ...f, [email]: { ...(f[email] || {}), [field]: value } }));
    await fetch("/api/followup/flag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, [field]: value }),
    });
  }

  const tabs: { id: TabKey; label: string; accent: string }[] = [
    { id: "lapsed30", label: "🔻 Lapsed 30d", accent: "#ef4444" },
    { id: "lapsed60", label: "🔻 Lapsed 60d", accent: "#f97316" },
    { id: "noshow", label: "No-Shows", accent: "#a855f7" },
    { id: "cancelled", label: "Cancelled Calls", accent: "#ef4444" },
    { id: "rescheduled", label: "Rescheduled", accent: "#eab308" },
  ];

  const rows = data[tab] ?? [];
  const markedCount = Object.values(flags).filter((f) => f.follow_up).length;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-dim text-xs uppercase tracking-widest">Queue</div>
        <h2 className="text-3xl font-bold tracking-tight">Follow-Up</h2>
        <div className="text-sm text-muted mt-1">
          {markedCount} marked for follow-up this week
        </div>
      </div>

      <Card className="!p-0">
        <div className="flex border-b border-border overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="px-5 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition"
              style={{
                color: tab === t.id ? "#e2e8f0" : "#94a3b8",
                borderBottomColor: tab === t.id ? t.accent : "transparent",
                marginBottom: -1,
              }}
            >
              {t.label}
              <span className="ml-2 bg-border text-muted px-2 py-0.5 rounded text-xs">
                {data[t.id]?.length ?? 0}
              </span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="p-8 text-dim text-center">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-dim text-center text-sm">No entries.</div>
        ) : (
          <div>
            <div className="grid grid-cols-[80px_1.3fr_1.5fr_1fr_1.5fr_1.5fr_60px] gap-3 px-5 py-3 border-b border-border text-[11px] uppercase tracking-wide text-dim">
              <span>Date</span>
              <span>Name</span>
              <span>Email</span>
              <span>Phone</span>
              <span>Gym Name</span>
              <span>Address</span>
              <span className="text-center">F/U</span>
            </div>
            {rows.map((r, i) => {
              const email = r.email || "";
              const flag = flags[email] || {};
              const isFu = !!flag.follow_up;
              return (
                <div
                  key={`${tab}-${i}-${email}`}
                  className="grid grid-cols-[80px_1.3fr_1.5fr_1fr_1.5fr_1.5fr_60px] gap-3 px-5 py-3 items-center text-sm"
                  style={{
                    background: isFu ? "#3b82f618" : undefined,
                    borderLeft: isFu ? "4px solid #3b82f6" : "4px solid transparent",
                    borderBottom: i < rows.length - 1 ? "1px solid #1e293b" : undefined,
                  }}
                >
                  <span className="text-muted text-xs">{r.date}</span>
                  <div>
                    <div className="font-medium">{r.name}{r.isMastermind && " ⭐"}</div>
                    {r.context && <div className="text-dim text-[11px] mt-0.5">{r.context}</div>}
                  </div>
                  <a href={`mailto:${r.email}`} className="text-accent-kpi text-xs truncate">{r.email}</a>
                  <span className="text-xs font-mono">
                    {r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : <span className="text-dim">—</span>}
                  </span>
                  <input
                    type="text"
                    placeholder="Gym name…"
                    defaultValue={flag.gym_name ?? ""}
                    onBlur={(e) => e.target.value !== (flag.gym_name ?? "") && updateField(email, "gym_name", e.target.value)}
                    className="bg-bg border border-border rounded px-2 py-1 text-xs text-text w-full focus:outline-none focus:border-accent-kpi"
                  />
                  <input
                    type="text"
                    placeholder="Address…"
                    defaultValue={flag.address_line1 ?? ""}
                    onBlur={(e) => e.target.value !== (flag.address_line1 ?? "") && updateField(email, "address_line1", e.target.value)}
                    className="bg-bg border border-border rounded px-2 py-1 text-xs text-text w-full focus:outline-none focus:border-accent-kpi"
                  />
                  <label className="flex justify-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isFu}
                      onChange={() => toggleFollowup(email)}
                      className="w-5 h-5 cursor-pointer accent-accent-kpi"
                    />
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
