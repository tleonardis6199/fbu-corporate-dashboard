import { Card } from "@/components/Card";
import type { MemberRow } from "@/lib/members";

export function MemberTable({
  rows,
  showLastPaid = false,
  showCanceledAt = false,
}: {
  rows: MemberRow[];
  showLastPaid?: boolean;
  showCanceledAt?: boolean;
}) {
  if (rows.length === 0) {
    return <Card><div className="text-dim text-sm">No members.</div></Card>;
  }
  const fmt = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
  const monthsSince = (iso: string | null) => {
    if (!iso) return 0;
    return Math.round((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  };

  const cols = showCanceledAt
    ? "1.4fr 1.6fr 1fr 1.5fr 0.9fr 0.9fr auto"
    : showLastPaid
    ? "1.4fr 1.6fr 1fr 1.5fr 0.9fr 0.9fr auto"
    : "1.4fr 1.6fr 1fr 1.5fr 0.8fr auto";

  return (
    <Card className="!p-0 overflow-x-auto">
      <div
        className="grid gap-3 px-5 py-3 border-b border-border text-[11px] uppercase tracking-wide text-dim"
        style={{ gridTemplateColumns: cols }}
      >
        <span>Name</span>
        <span>Email</span>
        <span>Phone</span>
        <span>Product</span>
        <span>Joined</span>
        {showLastPaid && <span>Last Paid</span>}
        {showCanceledAt && <span>Canceled</span>}
        <span className="text-right">{showLastPaid ? "LTV" : "MRR"}</span>
      </div>
      {rows.map((r, i) => (
        <div
          key={`${r.subId}-${i}`}
          className="grid gap-3 px-5 py-3 items-center text-sm"
          style={{
            gridTemplateColumns: cols,
            borderBottom: i < rows.length - 1 ? "1px solid #1e293b" : undefined,
          }}
        >
          <div>
            <div className="font-medium">{r.name ?? "—"}</div>
            {r.businessName && <div className="text-dim text-[11px]">{r.businessName}</div>}
          </div>
          <a href={`mailto:${r.email}`} className="text-accent-kpi text-xs truncate">{r.email ?? "—"}</a>
          <span className="text-xs font-mono">
            {r.phone ? <a href={`tel:${r.phone}`} className="text-text">{r.phone}</a> : <span className="text-dim">—</span>}
          </span>
          <span className="text-xs text-muted truncate" title={r.productName ?? ""}>{r.productName ?? "—"}</span>
          <span className="text-xs text-muted">
            {fmt(r.createdAt)}
          </span>
          {showLastPaid && (
            <span className="text-xs text-muted">
              {fmt(r.lastPaidAt)}
              {r.lastPaidAt && <span className="text-dim ml-1">({monthsSince(r.lastPaidAt)}mo)</span>}
            </span>
          )}
          {showCanceledAt && (
            <span className="text-xs" style={{ color: "#ef4444" }}>
              {fmt(r.canceledAt)}
            </span>
          )}
          <span className="text-right font-semibold">
            {showLastPaid
              ? `$${Math.round(r.totalPaid).toLocaleString()}`
              : `$${r.unitAmount.toLocaleString()}${r.interval === "week" ? "/wk" : "/mo"}`}
          </span>
        </div>
      ))}
    </Card>
  );
}
