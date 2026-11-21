"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { errorCode, errorMessage } from "@/lib/i18n";
import { parseDollarsToCents } from "@/lib/money";
import { dispatchClaimNotifications } from "@/lib/server/notify";

export type FinanceResult = { ok: true } | { ok: false; error: string };

const FINANCE_ERRORS: Record<string, string> = {
  dup_note_required: "중복 의심 건입니다. 확인한 내용을 한 줄 적어 주세요.",
  check_no_taken: "이미 쓴 수표 번호입니다(무효 처리한 수표 포함). 수표책의 번호를 확인해 주세요.",
  check_no_invalid: "수표 번호는 숫자만 넣어 주세요. 예: 1024",
  issued_on_in_future: "발행일이 미래입니다.",
  issued_before_verified: "발행일이 서류 확인일보다 빠릅니다.",
  issued_before_void: "재발행 날짜는 무효 처리한 날 이후여야 합니다.",
  one_payee_per_check: "수표 한 장에는 같은 분·같은 수령 방법·같은 주소의 청구만 묶을 수 있습니다.",
  amount_mismatch: "수표에 쓴 금액이 고른 청구서 합계와 다릅니다. 다시 확인해 주세요.",
  bad_cleared_on: "결제일을 확인해 주세요(발행일과 오늘 사이).",
  issuer_cannot_clear: "수표를 기록한 분은 결제 확인을 할 수 없습니다. 다른 재정부원이나 재정 담당 장로께 부탁해 주세요.",
  reason_required: "사유를 5자 이상 적어 주세요.",
};

const ids = z.object({ claimId: z.guid(), version: z.number().int().min(0).max(2147483647) });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function fail(err: { message?: string; code?: string } | null): FinanceResult {
  // A race on the same check number reaches the unique index instead of our check.
  if (err?.code === "23505") return { ok: false, error: FINANCE_ERRORS.check_no_taken };
  const code = errorCode(err?.message);
  return { ok: false, error: FINANCE_ERRORS[code] ?? errorMessage(code) };
}

export async function receiveClaim(claimId: string, version: number, dupNote: string): Promise<FinanceResult> {
  if (!ids.safeParse({ claimId, version }).success || typeof dupNote !== "string" || dupNote.length > 300) {
    return { ok: false, error: errorMessage("bad_request") };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("receive_claim", { p_claim: claimId, p_version: version, p_dup_note: dupNote });
  if (error) return fail(error);
  after(() => dispatchClaimNotifications(claimId));
  revalidatePath(`/claims/${claimId}`);
  revalidatePath("/finance");
  return { ok: true };
}

export async function returnClaim(claimId: string, version: number, reason: string): Promise<FinanceResult> {
  if (!ids.safeParse({ claimId, version }).success || !z.string().trim().min(1).max(300).safeParse(reason).success) {
    return { ok: false, error: errorMessage("reason_required") };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_claim", { p_claim: claimId, p_version: version, p_reason: reason });
  if (error) return fail(error);
  after(() => dispatchClaimNotifications(claimId));
  revalidatePath(`/claims/${claimId}`);
  revalidatePath("/finance");
  return { ok: true };
}

const paymentSchema = z.object({
  claims: z.array(z.guid()).min(1).max(50),
  checkNo: z.string().trim().min(1).max(20),
  issuedOn: day,
  amount: z.string().trim().min(1).max(20),
  memo: z.string().trim().max(300).optional().default(""),
});

export async function recordPayment(input: z.input<typeof paymentSchema>): Promise<FinanceResult> {
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "수표 번호, 금액, 발행일을 확인해 주세요." };
  const v = parsed.data;
  const cents = parseDollarsToCents(v.amount);
  if (cents === null || cents <= 0) return { ok: false, error: "수표 금액을 확인해 주세요. 예: 128.40" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payment", {
    p_claims: v.claims,
    p_check_no: v.checkNo,
    p_issued_on: v.issuedOn,
    p_memo: v.memo,
    p_check_amount_cents: cents,
  });
  if (error) return fail(error);
  after(async () => {
    for (const id of v.claims) await dispatchClaimNotifications(id);
  });
  revalidatePath("/finance");
  return { ok: true };
}

export async function markCleared(paymentId: string, clearedOn: string): Promise<FinanceResult> {
  if (!z.guid().safeParse(paymentId).success || !day.safeParse(clearedOn).success) {
    return { ok: false, error: FINANCE_ERRORS.bad_cleared_on };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_check_cleared", { p_payment: paymentId, p_cleared_on: clearedOn });
  if (error) return fail(error);
  revalidatePath("/finance");
  return { ok: true };
}

const reasonSchema = z.string().trim().min(5).max(300);

export async function unmarkCleared(paymentId: string, reason: string): Promise<FinanceResult> {
  if (!z.guid().safeParse(paymentId).success || !reasonSchema.safeParse(reason).success) {
    return { ok: false, error: FINANCE_ERRORS.reason_required };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("unmark_check_cleared", { p_payment: paymentId, p_reason: reason });
  if (error) return fail(error);
  revalidatePath("/finance");
  return { ok: true };
}

export async function voidPayment(paymentId: string, reason: string): Promise<FinanceResult> {
  if (!z.guid().safeParse(paymentId).success || !reasonSchema.safeParse(reason).success) {
    return { ok: false, error: FINANCE_ERRORS.reason_required };
  }
  const supabase = await createClient();
  const { data: links } = await supabase.from("payment_claims").select("claim_id").eq("payment_id", paymentId);
  const { error } = await supabase.rpc("void_payment", { p_payment: paymentId, p_reason: reason });
  if (error) return fail(error);
  after(async () => {
    for (const l of links ?? []) await dispatchClaimNotifications(l.claim_id);
  });
  revalidatePath("/finance");
  return { ok: true };
}
