"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { errorCode, errorMessage } from "@/lib/i18n";
import { dispatchClaimNotifications } from "@/lib/server/notify";

export type FinanceResult = { ok: true } | { ok: false; error: string };

const FINANCE_ERRORS: Record<string, string> = {
  dup_note_required: "중복 의심 건입니다. 확인한 내용을 한 줄 적어 주세요.",
  check_no_taken: "이미 기록된 수표 번호입니다.",
  check_no_required: "수표 번호를 넣어 주세요.",
  issued_on_in_future: "발행일이 미래입니다.",
  issued_before_verified: "발행일이 서류 확인일보다 빠릅니다.",
  one_payee_per_check: "수표 한 장에는 같은 분·같은 수령 방법의 청구만 묶을 수 있습니다.",
  bad_cleared_on: "결제일을 확인해 주세요.",
};

function fail(err: { message?: string } | null): FinanceResult {
  const code = errorCode(err?.message);
  return { ok: false, error: FINANCE_ERRORS[code] ?? errorMessage(code) };
}

export async function receiveClaim(claimId: string, version: number, dupNote: string): Promise<FinanceResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("receive_claim", { p_claim: claimId, p_version: version, p_dup_note: dupNote });
  if (error) return fail(error);
  await dispatchClaimNotifications(claimId);
  revalidatePath(`/claims/${claimId}`);
  revalidatePath("/finance");
  return { ok: true };
}

export async function returnClaim(claimId: string, version: number, reason: string): Promise<FinanceResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_claim", { p_claim: claimId, p_version: version, p_reason: reason });
  if (error) return fail(error);
  await dispatchClaimNotifications(claimId);
  revalidatePath(`/claims/${claimId}`);
  revalidatePath("/finance");
  return { ok: true };
}

const paymentSchema = z.object({
  claims: z.array(z.guid()).min(1).max(50),
  checkNo: z.string().trim().min(1).max(20),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().trim().max(300).optional().default(""),
});

export async function recordPayment(input: z.input<typeof paymentSchema>): Promise<FinanceResult> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "수표 번호와 발행일을 확인해 주세요." };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payment", {
    p_claims: v.claims,
    p_check_no: v.checkNo,
    p_issued_on: v.issuedOn,
    p_memo: v.memo,
  });
  if (error) return fail(error);
  for (const id of v.claims) await dispatchClaimNotifications(id);
  revalidatePath("/finance");
  return { ok: true };
}

export async function markCleared(paymentId: string, clearedOn: string): Promise<FinanceResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clearedOn)) return { ok: false, error: "결제일을 확인해 주세요." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_check_cleared", { p_payment: paymentId, p_cleared_on: clearedOn });
  if (error) return fail(error);
  revalidatePath("/finance");
  return { ok: true };
}
