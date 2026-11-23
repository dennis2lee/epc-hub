"use server";

import { createClient } from "@/lib/supabase/server";
import { clearInviteToken, readInviteToken } from "@/lib/server/invite-cookie";

const REASON_TEXT: Record<string, string> = {
  already_linked: "이 로그인 계정은 이미 다른 분과 연결되어 있습니다.\nThis sign-in is already linked to someone else.",
  invite_not_found: "초대 링크가 올바르지 않습니다.\nThis invite link is not valid.",
  invite_used: "이미 사용된 초대 링크입니다.\nThis invite link was already used.",
  invite_expired: "초대 링크의 기한이 지났습니다. 사무실에 새 링크를 요청해 주세요.\nThe invite has expired. Please ask the office.",
  invite_locked:
    "여러 번 틀려서 이 초대 링크가 잠겼습니다. 사무실에 새 링크를 요청해 주세요.\nToo many wrong tries; the link is locked. Please ask the office.",
  last4_mismatch: "번호가 맞지 않습니다. 다시 넣어 주세요.\nThe digits do not match. Please try again.",
  person_already_linked:
    "이미 연결된 분입니다. 처음 연결할 때 쓴 방법으로 로그인해 주세요. 안 되면 사무실에 알려 주세요.\n" +
    "Already linked. Please sign in the way you did the first time, or call the office.",
};

export async function acceptInvite(last4: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^\d{4}$/.test(last4)) return { ok: false, error: "숫자 4자리를 넣어 주세요.\nPlease enter 4 digits." };
  const token = await readInviteToken();
  if (!token) return { ok: false, error: REASON_TEXT.invite_not_found };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invite", { p_token: token, p_last4: last4 });
  if (error) return { ok: false, error: "확인하지 못했습니다. 다시 로그인해 주세요.\nCould not check. Please sign in again." };
  const result = data as { ok: boolean; reason?: string };
  if (!result.ok) return { ok: false, error: REASON_TEXT[result.reason ?? ""] ?? "확인하지 못했습니다." };
  await clearInviteToken();
  return { ok: true };
}
