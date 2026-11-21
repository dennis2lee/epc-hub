import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/server/env";
import { safeNextPath } from "@/lib/safe-next";

// Kakao option 2: our own OAuth/OIDC redirect so we control the scopes
// ("openid profile_nickname" only, no email). The callback exchanges the code
// for an id_token and hands it to Supabase via signInWithIdToken.
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const state = randomBytes(16).toString("hex");
  const nonce = randomBytes(16).toString("hex");

  const authorize = new URL("https://kauth.kakao.com/oauth/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", serverEnv.kakaoRestApiKey);
  authorize.searchParams.set("redirect_uri", `${origin}/auth/kakao/callback`);
  authorize.searchParams.set("scope", "openid profile_nickname");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);

  const response = NextResponse.redirect(authorize);
  const cookie = { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax" as const, path: "/auth/kakao", maxAge: 600 };
  response.cookies.set("kakao_oauth", JSON.stringify({ state, nonce, next }), cookie);
  return response;
}
