"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/admin";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      body: JSON.stringify({ password }),
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      router.push(next);
      router.refresh();
    } else {
      setError("Incorrect password.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <form
        onSubmit={onSubmit}
        className="bg-card border border-border rounded-xl p-8 w-full max-w-md"
      >
        <div className="text-dim text-xs uppercase tracking-wider mb-2">FBU</div>
        <h1 className="text-2xl font-bold mb-6">Dashboard access</h1>
        <label className="block text-sm text-muted mb-2">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          className="w-full bg-bg border border-border rounded-lg px-4 py-3 text-text focus:outline-none focus:border-accent-kpi mb-4"
        />
        {error && <div className="text-red-400 text-sm mb-4">{error}</div>}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full bg-accent-kpi hover:opacity-90 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-lg transition"
        >
          {loading ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
