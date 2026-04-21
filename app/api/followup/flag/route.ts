import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function POST(req: Request) {
  const body = await req.json();
  const { email, ...fields } = body;
  if (!email) {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  const sb = createServerClient();
  const { error } = await sb
    .from("user_flags")
    .upsert({ email, ...fields, updated_at: new Date().toISOString() }, { onConflict: "email" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
