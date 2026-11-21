"use server";

import { createClient } from "@/lib/supabase/server";

const REASON_TEXT: Record<string, string> = {
  already_linked: "이 로그인 계정은 이미 다른 분과 연결되어 있습니다.",
  invite_not_found: "초대 링크가 올바르지 않습니다.",
  invite_used: "이미 사용된 초대 링크입니다.",
  invite_expired: "초대 링크의 기한이 지났습니다. 사무실에 새 링크를 요청해 주세요.",
  invite_locked: "여러 번 틀려서 이 초대 링크가 잠겼습니다. 사무실에 새 링크를 요청해 주세요.",
  last4_mismatch: "번호가 맞지 않습니다. 다시 넣어 주세요.",
  person_already_linked: "이미 연결된 분입니다. 휴대폰을 바꾸셨다면 사무실에 알려 주세요.",
};

export async function acceptInvite(token: string, last4: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^\d{4}$/.test(last4)) return { ok: false, error: "숫자 4자리를 넣어 주세요." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invite", { p_token: token, p_last4: last4 });
  if (error) return { ok: false, error: "확인하지 못했습니다. 다시 로그인해 주세요." };
  const result = data as { ok: boolean; reason?: string };
  if (!result.ok) return { ok: false, error: REASON_TEXT[result.reason ?? ""] ?? "확인하지 못했습니다." };
  return { ok: true };
}
