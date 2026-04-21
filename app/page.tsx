import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="text-dim text-xs uppercase tracking-wider mb-2">FBU</div>
        <h1 className="text-4xl font-bold mb-4">Corporate Dashboard</h1>
        <p className="text-muted mb-8">
          Live sales pipeline, call metrics, and analytics.
        </p>
        <Link
          href="/admin"
          className="inline-block bg-accent-kpi hover:opacity-90 text-white font-semibold px-6 py-3 rounded-lg transition"
        >
          Enter Dashboard →
        </Link>
      </div>
    </main>
  );
}
