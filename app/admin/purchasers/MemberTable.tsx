import { Card } from "@/components/Card";
import type { MemberRow } from "@/lib/members";

export function MemberTable({ rows }: { rows: MemberRow[] }) {
  if (rows.length === 0) {
    return <Card><div className="text-dim text-sm">No members.</div></Card>;
  }
  const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
  const monthsActive = (createdAt: string) => {
    const months = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    return Math.round(months);
  };

  return (
    <Card className="!p-0 overflow-x-auto">
      <div className="grid grid-cols-[1.4fr_1.6fr_1fr_1.5fr_0.8fr_auto] gap-3 px-5 py-3 border-b border-border text-[11px] uppercase tracking-wide text-dim">
        <span>Name</span>
        <span>Email</span>
        <span>Phone</span>
        <span>Product</span>
        <span>Joined</span>
        <span className="text-right">MRR</span>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.subId}
          className="grid grid-cols-[1.4fr_1.6fr_1fr_1.5fr_0.8fr_auto] gap-3 px-5 py-3 items-center text-sm"
          style={{ borderBottom: i < rows.length - 1 ? "1px solid #1e293b" : undefined }}
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
            {fmtDate(r.createdAt)}
            <span className="text-dim ml-2">({monthsActive(r.createdAt)}mo)</span>
          </span>
          <span className="text-right font-semibold">
            ${r.unitAmount.toLocaleString()}
            <span className="text-dim text-xs">/{r.interval === "week" ? "wk" : "mo"}</span>
          </span>
        </div>
      ))}
    </Card>
  );
}
