"use server";

import { createHash, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { errorCode, errorMessage } from "@/lib/i18n";
import { parseDollarsToCents } from "@/lib/money";
import { dispatchClaimNotifications, recipientsWithoutEmail } from "@/lib/server/notify";
import { MAX_RECEIPT_BYTES, sniffReceiptType } from "@/lib/server/file-type";
import { createServiceClient } from "@/lib/server/admin";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function fail(err: { message?: string } | null | undefined): ActionResult {
  return { ok: false, error: errorMessage(errorCode(err?.message)) };
}

function invalid(): ActionResult {
  return { ok: false, error: errorMessage("bad_request") };
}

// Runtime checks for Server Action arguments; TypeScript types are not enforced at runtime.
const claimRef = z.object({ claimId: z.guid(), version: z.number().int().min(0).max(2147483647) });
const reasonText = z.string().trim().min(1).max(300);
const ipValue = z.union([z.ipv4(), z.ipv6()]);

async function clientInfo() {
  const h = await headers();
  // Vercel sets x-real-ip / x-vercel-forwarded-for itself; x-forwarded-for may
  // carry values added by the caller, so it is the last resort.
  const candidates: [string, string | undefined][] = [
    ["x-vercel-forwarded-for", h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()],
    ["x-real-ip", h.get("x-real-ip")?.trim()],
    ["x-forwarded-for", h.get("x-forwarded-for")?.split(",")[0]?.trim()],
  ];
  const found = candidates.find(([, v]) => v && ipValue.safeParse(v).success);
  return {
    ip: found?.[1] ?? null,
    ip_source: found?.[0] ?? null,
    ua: h.get("user-agent")?.slice(0, 300) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------
export async function createClaim(formData: FormData) {
  const department = String(formData.get("department") ?? "");
  if (!z.guid().safeParse(department).success) redirect("/claims/new?error=bad_department");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_claim", { p_department: department });
  if (error || !data) redirect(`/claims/new?error=${encodeURIComponent(errorCode(error?.message))}`);
  redirect(`/claims/${data}`);
}

const lineSchema = z.object({
  description: z.string().trim().min(1).max(200),
  amount: z.string().trim().max(20),
  budget_code: z.string().trim().max(40).optional().default(""),
});

const draftSchema = z.object({
  claimId: z.guid(),
  version: z.coerce.number().int(),
  department: z.guid(),
  purpose: z.string().trim().max(300),
  attendees: z.string().trim().max(300).optional().default(""),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
  checkDelivery: z.enum(["pickup", "mail"]),
  lines: z.array(lineSchema).max(30),
});

export type DraftInput = z.input<typeof draftSchema>;

export async function saveDraft(input: DraftInput): Promise<ActionResult & { version?: number }> {
  // Line-level messages first, so the screen can say which row is wrong.
  const rawLines = Array.isArray(input?.lines) ? input.lines : [];
  for (const [i, l] of rawLines.entries()) {
    const n = i + 1;
    if (!String(l?.description ?? "").trim()) {
      return { ok: false, error: `${n}번째 줄에 내용을 적어 주세요.\nRow ${n}: please enter what it was for.` };
    }
    const cents = parseDollarsToCents(String(l?.amount ?? ""));
    if (cents === null || cents <= 0) {
      return { ok: false, error: `${n}번째 줄 금액을 넣어 주세요. 예: 128.40\nRow ${n}: please enter the amount, e.g. 128.40` };
    }
  }
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: errorMessage("bad_request") };
  const v = parsed.data;
  const lines = v.lines.map((l) => ({
    description: l.description,
    amount_cents: parseDollarsToCents(l.amount) as number,
    budget_code: l.budget_code || null,
  }));

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
 * Receipt upload (decision D11): the server checks the bytes, computes SHA-256
 * and stores the file with the service role after checking that the caller is
 * the author of this draft. Users cannot write to the bucket directly.
 */
export async function uploadReceipt(formData: FormData): Promise<ActionResult> {
  const claimId = String(formData.get("claimId") ?? "");
  const file = formData.get("file");
  if (!z.guid().safeParse(claimId).success) return invalid();
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "파일이 없습니다.\nNo file was selected." };
  if (file.size > MAX_RECEIPT_BYTES) {
    return { ok: false, error: "파일이 4MB보다 큽니다. 사진을 다시 찍거나 줄여 주세요.\nThe file is larger than 4 MB." };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // The stored type comes from the file's bytes, never from the browser's claim.
  const type = sniffReceiptType(bytes);
  if (!type) return { ok: false, error: errorMessage("bad_type") };
  if (type.mime === "image/heic") return { ok: false, error: errorMessage("heic_unsupported") };
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = `${claimId}/${randomUUID()}.${type.ext}`;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { ok: false, error: errorMessage("not_member") };

  const service = createServiceClient();
  const { data: allowed } = await service.rpc("can_upload_receipt_srv", { p_actor_auth: userData.user.id, p_claim: claimId });
  if (allowed !== true) return { ok: false, error: errorMessage("stale_or_closed") };

  const { error: upErr } = await service.storage.from("receipts").upload(path, bytes, { contentType: type.mime, upsert: false });
  if (upErr) {
    console.error("[receipt] upload failed", upErr.message);
    return { ok: false, error: errorMessage("upload_failed") };
  }

  // The SQL function re-checks the actor, the draft and the stored object's metadata.
  const { error } = await service.rpc("add_attachment_srv", {
    p_actor_auth: userData.user.id,
    p_claim: claimId,
    p_storage_path: path,
    p_sha256: sha256,
    p_merchant: null as unknown as string,
    p_receipt_date: null as unknown as string,
    p_amount_cents: null as unknown as number,
  });
  if (error) {
    // The object was never recorded; remove it so it cannot be reused.
    await service.storage.from("receipts").remove([path]);
    return fail(error);
  }
  revalidatePath(`/claims/${claimId}`);
  return { ok: true };
}

export async function removeReceipt(attachmentId: string): Promise<ActionResult> {
  if (!z.guid().safeParse(attachmentId).success) return invalid();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remove_attachment", { p_attachment: attachmentId });
  if (error) return fail(error);
  // Files of a claim that was ever submitted stay as evidence (decision in M1 review).
  const result = data as { path: string; delete_file: boolean; claim_id: string } | null;
  if (result?.delete_file) await createServiceClient().storage.from("receipts").remove([result.path]);
  if (result?.claim_id) revalidatePath(`/claims/${result.claim_id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------
/**
 * Emails go out after the response so a slow mail provider never holds the
 * button. Returns a warning when the next person has no email address.
 */
async function afterTransition(claimId: string): Promise<string | undefined> {
  const missing = await recipientsWithoutEmail(claimId).catch(() => []);
  after(() => dispatchClaimNotifications(claimId));
  revalidatePath(`/claims/${claimId}`);
  revalidatePath("/");
  if (missing.length === 0) return undefined;
  return `${missing.join(", ")}님은 메일 주소가 없어 알리지 못했습니다. 카톡이나 전화로 알려 주세요.\nNo email address on file; please tell them by KakaoTalk or phone.`;
}

export async function submitClaim(claimId: string, version: number): Promise<ActionResult> {
  if (!claimRef.safeParse({ claimId, version }).success) return invalid();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_claim", { p_claim: claimId, p_version: version });
  if (error) {
    const code = errorCode(error.message);
    // Organization problems show up on the office's stuck list.
    if (["no_dept_head", "no_elder", "approver_not_active", "no_independent_approver"].includes(code)) {
      const { error: reportErr } = await supabase.rpc("report_blocked_submit", { p_claim: claimId, p_code: code });
      if (reportErr) console.error("[submit] report_blocked_submit failed", reportErr.message);
    }
    return fail(error);
  }
  const warning = await afterTransition(claimId);
  const result = data as { duplicate_warning?: boolean; late?: boolean };
  const notes = [];
  if (result.duplicate_warning) notes.push("같은 영수증이 이미 다른 청구서에 있는 것 같습니다. 재정부가 확인합니다.");
  if (result.late) notes.push("사용일에서 60일이 지난 청구입니다.");
  if (warning) notes.push(warning);
  return { ok: true, message: notes.join("\n") || undefined };
}

/** Save what is on screen, then submit that exact version (no stale submit). */
export async function saveAndSubmit(input: DraftInput): Promise<ActionResult> {
  const saved = await saveDraft(input);
  if (!saved.ok) return saved;
  return submitClaim(String(input.claimId), saved.version as number);
}

export async function withdrawClaim(claimId: string, version: number): Promise<ActionResult> {
  if (!claimRef.safeParse({ claimId, version }).success) return invalid();
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_claim", { p_claim: claimId, p_version: version });
  if (error) return fail(error);
  await afterTransition(claimId);
  return { ok: true };
}

export async function startRevision(claimId: string, version: number): Promise<ActionResult> {
  if (!claimRef.safeParse({ claimId, version }).success) return invalid();
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_revision", { p_claim: claimId, p_version: version });
  if (error) return fail(error);
  await afterTransition(claimId);
  return { ok: true };
}

export async function deleteDraft(claimId: string, version: number): Promise<ActionResult> {
  if (!claimRef.safeParse({ claimId, version }).success) return invalid();
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_draft", { p_claim: claimId, p_version: version });
  if (error) return fail(error);
  revalidatePath("/");
  redirect("/");
}

export async function cancelOwnClaim(claimId: string, version: number, reason: string): Promise<ActionResult> {
  if (!claimRef.safeParse({ claimId, version }).success || !reasonText.safeParse(reason).success) return invalid();
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
  if (!claimRef.safeParse({ claimId, version }).success || !["approve", "reject"].includes(decision)) return invalid();
  if (decision === "reject" && !reasonText.safeParse(reason).success) return { ok: false, error: errorMessage("reason_required") };
  if (typeof reason !== "string" || reason.length > 300) return invalid();
  const supabase = await createClient();
  const { error } = await supabase.rpc("act_on_claim", {
    p_claim: claimId,
    p_decision: decision,
    p_reason: reason,
    p_version: version,
    p_client: await clientInfo(),
  });
  if (error) return fail(error);
  const warning = await afterTransition(claimId);
  return { ok: true, message: warning };
}
