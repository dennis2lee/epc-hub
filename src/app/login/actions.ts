"use server";

import { readInviteToken } from "@/lib/server/invite-cookie";
import { createServiceClient } from "@/lib/server/admin";

/**
 * Whether an email code may create a new login. Only a browser that opened a
 * live invite link may; everyone else can sign in only to a login that
 * already exists. (Supabase can still be called directly; that residual risk
 * is recorded in doc/decisions.md D27.)
 */
export async function mayCreateLogin(): Promise<boolean> {
  const token = await readInviteToken();
  if (!token) return false;
  const { data, error } = await createServiceClient().rpc("invite_open_srv", { p_token: token });
  return !error && data === true;
}
