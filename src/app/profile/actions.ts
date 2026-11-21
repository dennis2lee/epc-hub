"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { errorCode, errorMessage } from "@/lib/i18n";

export async function saveProfile(input: {
  email: string;
  mailAddress: string;
  legalNameEn: string;
  lang: "ko" | "en";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_profile", {
    p_email: input.email,
    p_mail_address: input.mailAddress,
    p_legal_name_en: input.legalNameEn,
    p_lang: input.lang,
  });
  if (error) {
    const code = errorCode(error.message);
    return { ok: false, error: code === "bad_email" ? "이메일 주소를 확인해 주세요." : errorMessage(code) };
  }
  revalidatePath("/profile");
  return { ok: true };
}
