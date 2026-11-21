"use server";

import { createHash, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { errorCode, errorMessage } from "@/lib/i18n";
import { parseDollarsToCents } from "@/lib/money";
import { dispatchClaimNotifications } from "@/lib/server/notify";
import { MAX_RECEIPT_BYTES, sniffReceiptType } from "@/lib/server/file-type";
import { createServiceClient } from "@/lib/server/admin";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function fail(err: { message?: string } | null | undefined): ActionResult {
  return { ok: false, error: errorMessage(errorCode(err?.message)) };
}

async function clientInfo() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    ua: h.get("user-agent")?.slice(0, 300) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------
export async function createClaim(formData: FormData) {
  const department = String(formData.get("department") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_claim", { p_department: department });
  if (error || !data) redirect(`/claims/new?error=${encodeURIComponent(errorCode(error?.message))}`);
  redirect(`/claims/${data}`);
}

const lineSchema = z.object({
  description: z.string().trim().min(1).max(200),
  amount: z.string().trim(),
  budget_code: z.string().trim().max(40).optional().default(""),
});

const draftSchema = z.object({
  claimId: z.uuid(),
  version: z.coerce.number().int(),
  department: z.uuid(),
  purpose: z.string().trim().max(300),
  attendees: z.string().trim().max(300).optional().default(""),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
  checkDelivery: z.enum(["pickup", "mail"]),
  lines: z.array(lineSchema).max(30),
});

export type DraftInput = z.input<typeof draftSchema>;

export async function saveDraft(input: DraftInput): Promise<ActionResult & { version?: number }> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "입력 내용을 확인해 주세요." };
  const v = parsed.data;

  const lines = [];
  for (const l of v.lines) {
    const cents = parseDollarsToCents(l.amount);
    if (cents === null || cents <= 0) return { ok: false, error: `금액 "${l.amount}"을 확인해 주세요. 예: 128.40` };
    lines.push({ description: l.description, amount_cents: cents, budget_code: l.budget_code || null });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_claim_draft", {
    p_claim: v.claimId,
    p_version: v.version,
    p_department: v.department,
    p_purpose: v.purpose,
    p_attendees: v.attendees || "",
    p_expense_date: v.expenseDate || (null as unknown as string),
    p_check_delivery: v.checkDelivery,
    p_lines: lines,
  });
  if (error) return fail(error);
  revalidatePath(`/claims/${v.claimId}`);
  return { ok: true, version: data as number };
}


/**
 * Receipt upload (decision D11): the server computes SHA-256 from the bytes and
 * stores the file with the user's own session, so storage policies apply.
 */
export async function uploadReceipt(formData: FormData): Promise<ActionResult> {
  const claimId = String(formData.get("claimId") ?? "");
  const file = formData.get("file");
  if (!z.uuid().safeParse(claimId).success) return { ok: false, error: "잘못된 요청입니다." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "파일이 없습니다." };
  if (file.size > MAX_RECEIPT_BYTES) return { ok: false, error: "파일이 4MB보다 큽니다. 사진을 다시 찍거나 줄여 주세요." };

  const merchant = String(formData.get("merchant") ?? "").trim().slice(0, 100);
  const receiptDate = String(formData.get("receiptDate") ?? "");
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const amountCents = amountRaw ? parseDollarsToCents(amountRaw) : null;
  if (amountRaw && amountCents === null) return { ok: false, error: "영수증 금액을 확인해 주세요." };

  const bytes = Buffer.from(await file.arrayBuffer());
  // The stored type comes from the file's bytes, never from the browser's claim.
  const type = sniffReceiptType(bytes);
  if (!type) return { ok: false, error: "사진(JPG·PNG·HEIC) 또는 PDF만 올릴 수 있습니다." };
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = `${claimId}/${randomUUID()}.${type.ext}`;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, error: errorMessage("not_member") };
  const { error: upErr } = await supabase.storage
    .from("receipts")
    .upload(path, bytes, { contentType: type.mime, upsert: false });
  if (upErr) return { ok: false, error: "올리지 못했습니다. 작성 중인 청구서인지 확인해 주세요." };

  // Recording the attachment is a server-only call (decision D11): the SQL
  // function re-checks the actor, the draft and the stored object's metadata.
  const service = createServiceClient();
  const { error } = await service.rpc("add_attachment_srv", {
    p_actor_auth: userData.user.id,
    p_claim: claimId,
    p_storage_path: path,
    p_sha256: sha256,
    p_merchant: merchant,
    p_receipt_date: /^\d{4}-\d{2}-\d{2}$/.test(receiptDate) ? receiptDate : (null as unknown as string),
    p_amount_cents: amountCents as number,
  });
  if (error) {
    // The object was never recorded; remove it so it cannot be reused.
    await service.storage.from("receipts").remove([path]);
    return fail(error);
  }
  revalidatePath(`/claims/${claimId}`);
  return { ok: true };
}

export async function removeReceipt(attachmentId: string, claimId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remove_attachment", { p_attachment: attachmentId });
  if (error) return fail(error);
  // Files of a claim that was ever submitted stay as evidence (decision in M1 review).
  const result = data as { path: string; delete_file: boolean } | null;
  if (result?.delete_file) await createServiceClient().storage.from("receipts").remove([result.path]);
  revalidatePath(`/claims/${claimId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------
async function afterTransition(claimId: string) {
  await dispatchClaimNotifications(claimId);
  revalidatePath(`/claims/${claimId}`);
  revalidatePath("/");
}

export async function submitClaim(claimId: string, version: number): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_claim", { p_claim: claimId, p_version: version });
  if (error) {
    const code = errorCode(error.message);
    // Organization problems show up on the office's stuck list.
    if (["no_dept_head", "no_elder", "approver_not_active", "no_independent_approver"].includes(code)) {
      await supabase.rpc("report_blocked_submit", { p_claim: claimId, p_code: code });
    }
    return fail(error);
  }
  await afterTransition(claimId);
  const result = data as { duplicate_warning?: boolean; late?: boolean };
  const notes = [];
  if (result.duplicate_warning) notes.push("같은 영수증이 이미 다른 청구서에 있는 것 같습니다. 재정부가 확인합니다.");
  if (result.late) notes.push("사용일에서 60일이 지난 청구입니다.");
  return { ok: true, message: notes.join(" ") || undefined };
}

export async function withdrawClaim(claimId: string, version: number): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_claim", { p_claim: claimId, p_version: version });
  if (error) return fail(error);
  await afterTransition(claimId);
  return { ok: true };
}

export async function startRevision(claimId: string, version: number): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_revision", { p_claim: claimId, p_version: version });
  if (error) return fail(error);
  await afterTransition(claimId);
  return { ok: true };
}

export async function deleteDraft(claimId: string, version: number): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_draft", { p_claim: claimId, p_version: version });
  if (error) return fail(error);
  revalidatePath("/");
  redirect("/");
}

export async function cancelOwnClaim(claimId: string, version: number, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_own_claim", { p_claim: claimId, p_version: version, p_reason: reason });
  if (error) return fail(error);
  revalidatePath("/");
  revalidatePath(`/claims/${claimId}`);
  return { ok: true };
}

export async function actOnClaim(
  claimId: string,
  version: number,
  decision: "approve" | "reject",
  reason: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("act_on_claim", {
    p_claim: claimId,
    p_decision: decision,
    p_reason: reason,
    p_version: version,
    p_client: await clientInfo(),
  });
  if (error) return fail(error);
  await afterTransition(claimId);
  return { ok: true };
}
