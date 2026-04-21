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
  const fmt = (iso: string | null) => {
    if (!iso) return "—";
    // Accept both ISO and M/D/YYYY
    if (iso.length <= 10 && iso.includes("/")) return iso;
    return iso.slice(0, 10);
  };

  const cols = "1.4fr 1.5fr 1.4fr 1fr 1.5fr 0.9fr auto";

  return (
    <Card className="!p-0 overflow-x-auto">
      <div
        className="grid gap-3 px-5 py-3 border-b border-border text-[11px] uppercase tracking-wide text-dim"
        style={{ gridTemplateColumns: cols }}
      >
        <span>Name</span>
        <span>Gym / Email</span>
        <span>Phone / Address</span>
        <span>Tier</span>
        <span>Product (Stripe)</span>
        <span>Joined</span>
        <span className="text-right">{showLastPaid ? "LTV" : "MRR"}</span>
      </div>
      {rows.map((r, i) => (
        <div
          key={`${r.id}-${i}`}
          className="grid gap-3 px-5 py-3 items-start text-sm"
          style={{
            gridTemplateColumns: cols,
            borderBottom: i < rows.length - 1 ? "1px solid #1e293b" : undefined,
          }}
        >
          <div>
            <div className="font-medium">{r.name ?? "—"}</div>
            {r.staff && <div className="text-dim text-[11px] mt-0.5 truncate" title={r.staff}>Staff: {r.staff}</div>}
          </div>
          <div className="text-xs">
            {r.gymName && <div className="text-text font-medium">{r.gymName}</div>}
            {r.allEmails.map((e) => (
              <a key={e} href={`mailto:${e}`} className="text-accent-kpi block truncate">{e}</a>
            ))}
          </div>
          <div className="text-xs">
            <div className="font-mono">
              {r.phone ? <a href={`tel:${r.phone}`} className="text-text">{r.phone}</a> : <span className="text-dim">—</span>}
            </div>
            {r.address && <div className="text-dim text-[11px] mt-0.5 truncate" title={r.address}>{r.address}</div>}
          </div>
          <div className="text-xs">
            <span
              className="font-bold"
              style={{
                color: r.category === "mastermind" ? "#a855f7"
                  : r.category === "elite" ? "#f59e0b"
                  : r.category === "ceo" ? "#ec4899"
                  : r.category === "nca" ? "#eab308"
                  : "#94a3b8",
              }}
            >
              {r.tier ?? "—"}
            </span>
          </div>
          <div className="text-xs text-muted">
            {r.activeProducts.length > 0 ? (
              r.activeProducts.map((p) => <div key={p}>{p}</div>)
            ) : r.stripeCustomerId ? (
              <span className="text-dim italic">No active sub</span>
            ) : (
              <span className="text-dim italic">Not in Stripe</span>
            )}
          </div>
          <span className="text-xs text-muted">{fmt(r.dateJoined)}</span>
          <span className="text-right font-semibold">
            {showLastPaid
              ? `$${Math.round(r.totalPaid).toLocaleString()}`
              : r.currentMrr > 0
              ? `$${r.currentMrr.toLocaleString()}/mo`
              : <span className="text-dim">—</span>}
          </span>
        </div>
      ))}
    </Card>
  );
}
