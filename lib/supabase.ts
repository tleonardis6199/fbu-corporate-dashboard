import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client using the service_role key.
// NEVER import this into a client component. Server actions / API routes only.
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
