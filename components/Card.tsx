export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-card border border-border rounded-xl p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function KPI({
  label,
  value,
  sub,
  color = "#3b82f6",
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <Card className="flex-1 min-w-[140px]">
      <div className="text-muted text-[11px] uppercase tracking-wider mb-1.5">
        {label}
      </div>
      <div className="text-3xl font-bold leading-none" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-dim text-xs mt-1.5">{sub}</div>}
    </Card>
  );
}

export function SectionHeader({
  accent,
  title,
  count,
  subtitle,
}: {
  accent: string;
  title: string;
  count?: number;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center mb-4" style={{ borderLeft: `4px solid ${accent}`, paddingLeft: 12 }}>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {count !== undefined && (
        <span className="ml-3 bg-border text-muted px-2.5 py-0.5 rounded-xl text-xs font-medium">
          {count}
        </span>
      )}
      {subtitle && <span className="ml-3 text-dim text-xs">{subtitle}</span>}
    </div>
  );
}
