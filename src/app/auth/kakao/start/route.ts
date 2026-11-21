import { NextResponse, type NextRequest } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/server/env";
import { safeNextPath } from "@/lib/safe-next";

// Kakao option 2: our own OAuth/OIDC redirect so we control the scopes
// ("openid profile_nickname" only, no email). The callback exchanges the code
// for an id_token and hands it to Supabase via signInWithIdToken, which also
// verifies the token signature, issuer and audience (the Supabase Kakao
// provider must be enabled with the same REST API key).
export async function GET(request: NextRequest) {
  const origin = serverEnv.appOrigin;
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const state = randomBytes(16).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  // Supabase compares sha256(nonce) with the id_token's nonce claim, so the
  // provider receives the hash and Supabase later receives the raw value.
  const hashedNonce = createHash("sha256").update(nonce).digest("hex");

  const authorize = new URL("https://kauth.kakao.com/oauth/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", serverEnv.kakaoRestApiKey);
  authorize.searchParams.set("redirect_uri", `${origin}/auth/kakao/callback`);
  authorize.searchParams.set("scope", "openid profile_nickname");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", hashedNonce);

  const response = NextResponse.redirect(authorize);
  response.cookies.set("kakao_oauth", JSON.stringify({ state, nonce, next }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/auth/kakao",
    maxAge: 600,
  });
  return response;
}
