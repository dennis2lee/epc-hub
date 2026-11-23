import { NextResponse, connection } from "next/server";
import { createServiceClient } from "@/lib/server/admin";
import { publicEnv } from "@/lib/env";

// Liveness for the deploy script and the uptime monitor: the app is up AND it
// can reach the database and the Auth server. Says nothing else.
export async function GET() {
  await connection();
  try {
    const db = createServiceClient();
    const [{ error: dbError }, auth] = await Promise.all([
      db.from("app_settings").select("key").limit(1),
      fetch(`${publicEnv.supabaseServerUrl}/auth/v1/health`, {
        headers: { apikey: publicEnv.supabasePublishableKey },
        signal: AbortSignal.timeout(5000),
      }),
    ]);
    if (dbError || !auth.ok) return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
