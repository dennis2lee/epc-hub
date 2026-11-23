import "server-only";
import { cookies } from "next/headers";

// The invite token travels in an httpOnly cookie after the first open, so it
// never appears in later URLs (?next=, Kakao round trips) or in the page.
export const INVITE_COOKIE = "invite_token";
export const INVITE_TOKEN_RE = /^[0-9a-f]{48}$/;

export async function readInviteToken(): Promise<string | null> {
  const v = (await cookies()).get(INVITE_COOKIE)?.value ?? "";
  return INVITE_TOKEN_RE.test(v) ? v : null;
}

export async function clearInviteToken(): Promise<void> {
  (await cookies()).delete(INVITE_COOKIE);
}
