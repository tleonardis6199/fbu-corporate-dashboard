import { Card, KPI, SectionHeader } from "@/components/Card";
import { getCallStatus, getCloses, getRecentContacts, getSheetFbAds } from "@/lib/queries";

export const dynamic = "force-dynamic";

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today() { return new Date().toISOString().slice(0, 10); }

export default async function MTDPage() {
  const start = firstOfMonth();
  const end = today();

  const [calls, closes, newContacts, fbAds] = await Promise.all([
    getCallStatus(start, end),
    getCloses(start, end),
    getRecentContacts(30),
    getSheetFbAds(30),
  ]);

  const attended = calls.filter((c) => c.status === "Attended").length;
  const noShow = calls.filter((c) => c.status === "No Show").length;
  const cancelled = calls.filter((c) => c.status === "Cancelled").length;
  const rescheduled = calls.filter((c) => c.status === "Rescheduled").length;
  const showRate = calls.length ? Math.round((attended / calls.length) * 100) : 0;
  const fbSpend = fbAds.reduce((s, r) => s + Number(r.spend ?? 0), 0);
  const fbLpvs = fbAds.reduce((s, r) => s + Number(r.lpvs ?? 0), 0);
  const fbLeads = fbAds.reduce((s, r) => s + Number(r.website_leads ?? 0), 0);
  const revenue = closes.reduce((s, c) => s + Number(c.amount ?? 0), 0);

  return (
    <div className="space-y-8">
      <div>
        <div className="text-dim text-xs uppercase tracking-widest">Month to date + last 30 days</div>
        <h2 className="text-3xl font-bold tracking-tight">MTD + L30</h2>
        <div className="text-sm text-muted mt-1">{start} → {end}</div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <KPI label="Show Rate MTD" value={`${showRate}%`} sub={`${attended}/${calls.length} attended`} color={showRate >= 60 ? "#22c55e" : showRate >= 30 ? "#f97316" : "#ef4444"} />
        <KPI label="Calls MTD" value={calls.length} sub={`${cancelled} cancel · ${noShow} ns · ${rescheduled} resched`} />
        <KPI label="Closes MTD" value={closes.length} sub={`$${revenue.toLocaleString()} revenue`} color="#22c55e" />
        <KPI label="New Contacts L30" value={newContacts} sub="GHL" color="#8b5cf6" />
        <KPI label="FB Spend L30" value={`$${fbSpend.toFixed(0)}`} sub={`${fbLpvs.toLocaleString()} LPVs · ${fbLeads} leads`} color="#1877f2" />
      </div>

      <div>
        <SectionHeader accent="#22c55e" title="MTD Closes" count={closes.length} />
        <Card className="!p-0">
          {closes.length === 0 && <div className="p-5 text-dim text-sm">No closes yet this month.</div>}
          {closes.map((c, i) => (
            <div
              key={c.id}
              className="grid grid-cols-[100px_1.5fr_1.5fr_1fr_auto] gap-3 px-5 py-3 items-center text-sm"
              style={{ borderBottom: i < closes.length - 1 ? "1px solid #1e293b" : undefined }}
            >
              <span className="text-muted text-xs">{c.sale_date}</span>
              <span className="font-medium">{c.name}</span>
              <span className="text-muted text-xs">{c.email}</span>
              <span className={c.program?.includes("Mastermind") ? "text-status-won font-bold text-xs" : "text-muted text-xs"}>{c.program}</span>
              <span className="text-right font-semibold">${Number(c.amount).toLocaleString()}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
