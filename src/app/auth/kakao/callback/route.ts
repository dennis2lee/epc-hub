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

function fail(origin: string, next: string, message: string) {
  const url = new URL("/login", origin);
  url.searchParams.set("error", message.slice(0, 200));
  url.searchParams.set("next", next);
  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: "kakao_oauth", path: "/auth/kakao" });
  return response;
}

export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;

  let saved: { state: string; nonce: string; next: string } | null = null;
  try {
    saved = JSON.parse(request.cookies.get("kakao_oauth")?.value ?? "null");
  } catch {
    saved = null;
  }
  const next = safeNextPath(saved?.next);

  if (searchParams.get("error")) {
    return fail(origin, next, searchParams.get("error_description") ?? "kakao_error");
  }
  // The state cookie only exists in the browser that started the flow. If the
  // user bounced between KakaoTalk and another browser, it is missing.
  if (!saved || saved.state !== searchParams.get("state")) {
    return fail(origin, next, "kakao_state_mismatch");
  }
  const code = searchParams.get("code");
  if (!code) return fail(origin, next, "kakao_no_code");

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
  });
  const token = (await tokenRes.json()) as KakaoTokenResponse;
  if (!tokenRes.ok || !token.id_token) {
    return fail(origin, next, token.error_description ?? token.error ?? "kakao_no_id_token");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "kakao",
    token: token.id_token,
    access_token: token.access_token,
    nonce: saved.nonce,
  });
  if (error) return fail(origin, next, `supabase: ${error.message}`);

  const response = NextResponse.redirect(new URL(next, origin));
  response.cookies.delete({ name: "kakao_oauth", path: "/auth/kakao" });
  return response;
}
