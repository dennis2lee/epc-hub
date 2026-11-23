import { NextResponse, type NextRequest } from "next/server";
import { INVITE_COOKIE, INVITE_TOKEN_RE } from "@/lib/server/invite-cookie";

// First open of an invite link: keep the token in an httpOnly cookie and move
// to the token-free /invite page. Opening never consumes the invite (KakaoTalk
// link previews fetch it too); the token is checked on /invite.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const target = new URL("/invite", request.nextUrl.origin);
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (INVITE_TOKEN_RE.test(token)) {
    response.cookies.set(INVITE_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
  }
  return response;
}
