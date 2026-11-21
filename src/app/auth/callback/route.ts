import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-next";

// OAuth return point for Kakao option 1 (Supabase's built-in Kakao provider).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");

  if (providerError) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", providerError.slice(0, 200));
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
    const url = new URL("/login", origin);
    url.searchParams.set("error", error.message.slice(0, 200));
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(new URL("/login", origin));
}
