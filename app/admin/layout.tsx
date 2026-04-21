import Link from "next/link";

const TABS = [
  { href: "/admin", label: "This Week", icon: "📅" },
  { href: "/admin/mtd", label: "MTD + L30", icon: "📊" },
  { href: "/admin/purchasers", label: "Past Purchasers", icon: "💰" },
  { href: "/admin/followup", label: "Follow-Up", icon: "🔁" },
  { href: "/admin/analytics", label: "Analytics", icon: "📈" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/40 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-dim text-[11px] uppercase tracking-widest">FBU</div>
            <h1 className="text-xl font-bold">Corporate Dashboard</h1>
          </div>
          <form action="/api/logout" method="POST">
            <button
              type="submit"
              className="text-muted hover:text-text text-sm underline"
            >
              Sign out
            </button>
          </form>
        </div>
        <nav className="max-w-[1400px] mx-auto px-6 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="px-5 py-3 text-sm font-semibold text-muted hover:text-text border-b-2 border-transparent hover:border-border transition whitespace-nowrap"
            >
              <span className="mr-2">{t.icon}</span>
              {t.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="max-w-[1400px] mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
