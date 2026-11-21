import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/server/env";

export async function POST(request: NextRequest) {
  // Route Handlers have no built-in Origin check (unlike Server Actions).
  const sent = request.headers.get("origin");
  if (sent && sent !== serverEnv.appOrigin && sent !== request.nextUrl.origin) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const supabase = await createClient();
  // Sign out this device only; other devices stay signed in.
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/login", serverEnv.appOrigin), { status: 303 });
}
