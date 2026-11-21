import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/server/env";
import { safeNextPath } from "@/lib/safe-next";

type KakaoTokenResponse = {
  access_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

// Only short error codes travel in the URL; the login page maps them to fixed
// text so a crafted link cannot show arbitrary messages on our domain.
function fail(next: string, code: string, detail?: unknown) {
  if (detail) console.error(`[kakao] ${code}`, detail);
  const url = new URL("/login", serverEnv.appOrigin);
  url.searchParams.set("error", code);
  url.searchParams.set("next", next);
  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: "kakao_oauth", path: "/auth/kakao" });
  return response;
}

export async function GET(request: NextRequest) {
  const origin = serverEnv.appOrigin;
  const { searchParams } = request.nextUrl;

  let saved: { state: string; nonce: string; next: string } | null = null;
  try {
    saved = JSON.parse(request.cookies.get("kakao_oauth")?.value ?? "null");
  } catch {
    saved = null;
  }
  const next = safeNextPath(saved?.next);

  // The state cookie only exists in the browser that started the flow. If the
  // user bounced between KakaoTalk and another browser, it is missing.
  if (!saved || saved.state !== searchParams.get("state")) return fail(next, "kakao_state_mismatch");
  if (searchParams.get("error")) return fail(next, "kakao_denied", searchParams.get("error_description"));
  const code = searchParams.get("code");
  if (!code) return fail(next, "kakao_failed");

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: serverEnv.kakaoRestApiKey,
      redirect_uri: `${origin}/auth/kakao/callback`,
      code,
    });
    if (serverEnv.kakaoClientSecret) body.set("client_secret", serverEnv.kakaoClientSecret);

    const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const token = (await tokenRes.json().catch(() => ({}))) as KakaoTokenResponse;
    if (!tokenRes.ok || !token.id_token) {
      return fail(next, "kakao_failed", token.error_description ?? token.error ?? tokenRes.status);
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithIdToken({
      provider: "kakao",
      token: token.id_token,
      access_token: token.access_token,
      nonce: saved.nonce,
    });
    if (error) return fail(next, "auth_failed", error.message);
  } catch (err) {
    return fail(next, "kakao_unavailable", err);
  }

  const response = NextResponse.redirect(new URL(next, origin));
  response.cookies.delete({ name: "kakao_oauth", path: "/auth/kakao" });
  return response;
}
