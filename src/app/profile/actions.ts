"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { errorCode, errorMessage } from "@/lib/i18n";
import { dispatchPersonNotifications } from "@/lib/server/notify";

const profileSchema = z.object({
  email: z.email().max(254).or(z.literal("")),
  mailAddress: z.string().max(300),
  legalNameEn: z.string().max(100),
  lang: z.enum(["ko", "en"]),
});

export async function saveProfile(input: {
  email: string;
  mailAddress: string;
  legalNameEn: string;
  lang: "ko" | "en";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = profileSchema.safeParse({ ...input, email: String(input?.email ?? "").trim() });
  if (!parsed.success) {
    const emailBad = parsed.error.issues.some((i) => i.path[0] === "email");
    return { ok: false, error: errorMessage(emailBad ? "bad_email" : "bad_request") };
  }
  const v = parsed.data;
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");
  const { error } = await supabase.rpc("update_my_profile", {
    p_email: v.email,
    p_mail_address: v.mailAddress,
    p_legal_name_en: v.legalNameEn,
    p_lang: v.lang,
  });
  if (error) return { ok: false, error: errorMessage(errorCode(error.message)) };
  // A changed email queues a notice to the old address (update_my_profile).
  const personId = (me as { person_id?: string } | null)?.person_id;
  if (personId) after(() => dispatchPersonNotifications(personId));
  revalidatePath("/profile");
  return { ok: true };
}
