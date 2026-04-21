import { Card, KPI, SectionHeader } from "@/components/Card";
import {
  getPipelineOpportunities,
  getRecentContacts,
  getLapsedSubscriptions,
  getCallStatus,
  getCloses,
} from "@/lib/queries";

// Server component — data fetched on each request (cached briefly by Next)
export const dynamic = "force-dynamic";

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

export default async function ThisWeekPage() {
  const today = new Date();
  const sevenAgo = new Date(today.getTime() - 7 * 86400000);
  const last7Start = ymd(sevenAgo);
  const last7End = ymd(today);

  const [pipeline, newContactsL7, lapsed60, callStatus, closes] = await Promise.all([
    getPipelineOpportunities(),
    getRecentContacts(7),
    getLapsedSubscriptions(60),
    getCallStatus(last7Start, last7End),
    getCloses(last7Start, last7End),
  ]);

  const attended = callStatus.filter((c) => c.status === "Attended").length;
  const noShow = callStatus.filter((c) => c.status === "No Show").length;
  const cancelled = callStatus.filter((c) => c.status === "Cancelled").length;
  const rescheduled = callStatus.filter((c) => c.status === "Rescheduled").length;
  const totalCalls = callStatus.length;
  const showRate = totalCalls ? Math.round((attended / totalCalls) * 100) : 0;

  const hotList = pipeline.filter((p) =>
    ["Second Call Scheduled", "Qualified", "Closing"].includes(p.stage_name ?? "")
  );

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-dim text-xs uppercase tracking-widest">Last 7 days</div>
          <h2 className="text-3xl font-bold tracking-tight">This Week</h2>
        </div>
        <div className="text-right text-sm text-muted">
          {last7Start} → {last7End}
        </div>
      </div>

      {/* KPIs */}
      <div className="flex gap-3 flex-wrap">
        <KPI label="Show Rate L7" value={`${showRate}%`} sub={`${attended}/${totalCalls} attended`} color={showRate >= 60 ? "#22c55e" : showRate >= 30 ? "#f97316" : "#ef4444"} />
        <KPI label="Calls L7" value={totalCalls} sub={`${cancelled} cancel · ${noShow} ns · ${rescheduled} resched`} />
        <KPI label="Open Pipeline" value={pipeline.length} sub={`${hotList.length} hot`} color="#a855f7" />
        <KPI label="Closes L7" value={closes.length} sub={`$${closes.reduce((s, c) => s + Number(c.amount ?? 0), 0).toLocaleString()}`} color="#22c55e" />
        <KPI label="New Contacts L7" value={newContactsL7} sub="GHL" color="#8b5cf6" />
        <KPI label="🔻 Lapsed L60" value={lapsed60.length} color="#ef4444" />
      </div>

      {/* Hot list */}
      <div>
        <SectionHeader accent="#ef4444" title="🔥 Hot List" count={hotList.length} subtitle="Advancing or closing" />
        <Card className="!p-0">
          {hotList.length === 0 && <div className="p-5 text-dim text-sm">No hot prospects yet. Sync data first.</div>}
          {hotList.map((p, i) => (
            <div
              key={p.id}
              className="grid grid-cols-[2fr_2fr_1fr_auto] gap-3 px-5 py-3 items-center text-sm"
              style={{ borderBottom: i < hotList.length - 1 ? "1px solid #1e293b" : undefined }}
            >
              <div className="font-semibold">{p.name}</div>
              <div className="text-muted text-xs">{p.pipeline_name}</div>
              <div className="text-accent-pipeline text-xs font-semibold">{p.stage_name}</div>
              <div className="text-right font-semibold">
                {p.monetary_value ? `$${Number(p.monetary_value).toLocaleString()}` : <span className="text-dim">$0</span>}
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* Report-week calls */}
      <div>
        <SectionHeader accent="#6366f1" title="Report-Week Calls" count={callStatus.length} subtitle={`${last7Start} → ${last7End}`} />
        <Card className="!p-0">
          {callStatus.length === 0 && <div className="p-5 text-dim text-sm">No calls in window.</div>}
          {callStatus.map((c, i) => {
            const statusColor = c.status === "Attended" ? "#22c55e" : c.status === "No Show" ? "#a855f7" : c.status === "Cancelled" ? "#ef4444" : "#eab308";
            return (
              <div
                key={c.id}
                className="grid grid-cols-[100px_1.5fr_1.5fr_1fr_auto] gap-3 px-5 py-3 items-center text-sm"
                style={{ borderLeft: `4px solid ${statusColor}`, borderBottom: i < callStatus.length - 1 ? "1px solid #1e293b" : undefined, background: statusColor + "0d" }}
              >
                <span className="text-muted text-xs">{c.call_date}</span>
                <span className="font-medium">{c.name}</span>
                <span className="text-muted text-xs">{c.email}</span>
                <span className="text-dim text-xs">{c.call_type}</span>
                <span
                  className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded border"
                  style={{ color: statusColor, borderColor: statusColor + "88", background: statusColor + "22" }}
                >
                  {c.status ?? "—"}
                </span>
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}
