import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/server/env";
import { safeNextPath } from "@/lib/safe-next";

// OAuth return point for Kakao option 1 (Supabase's built-in Kakao provider).
export async function GET(request: NextRequest) {
  const origin = serverEnv.appOrigin;
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));

  function fail(code: string, detail?: unknown) {
    if (detail) console.error(`[auth/callback] ${code}`, detail);
    const url = new URL("/login", origin);
    url.searchParams.set("error", code);
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  if (searchParams.get("error")) return fail("kakao_denied", searchParams.get("error_description"));
  const code = searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login", origin));

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail("auth_failed", error.message);
  return NextResponse.redirect(new URL(next, origin));
}
