"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { errorCode, errorMessage } from "@/lib/i18n";
import { after } from "next/server";
import { dispatchClaimNotifications } from "@/lib/server/notify";
import { serverEnv } from "@/lib/server/env";

export type AdminResult = { ok: true; value?: string } | { ok: false; error: string };

const ADMIN_ERRORS: Record<string, string> = {
  not_admin: "관리자만 할 수 있습니다.",
  cannot_confirm_self: "본인은 대면 확인할 수 없습니다. 다른 관리자가 해야 합니다.",
  cannot_assign_self: "본인에게 직책을 줄 수 없습니다.",
  cannot_change_self: "본인 상태는 바꿀 수 없습니다.",
  finance_role_needs_finance_department: "재정 직책은 재정부에만 줄 수 있습니다.",
  not_linked: "아직 로그인 계정이 연결되지 않은 분입니다.",
  not_invitable: "이미 연결된 분입니다.",
  no_new_approver: "새로 결재할 사람이 없습니다. 먼저 직책을 배정해 주세요.",
  bad_end_date: "끝나는 날짜를 확인해 주세요.",
  reason_required: "이유를 적어 주세요.",
  not_found: "대상을 찾을 수 없습니다. 새로 보기를 눌러 주세요.",
  name_required: "이름을 넣어 주세요.",
  not_suspended: "정지된 분이 아닙니다.",
  use_confirm_in_person: "사용 시작은 '대면 확인 완료'로 해 주세요.",
};

const id = z.guid();
const invalid: AdminResult = { ok: false, error: "입력 내용을 확인해 주세요." };

function fail(err: { message?: string; code?: string } | null): AdminResult {
  if (err?.code === "23P01") return { ok: false, error: "같은 기간에 이미 그 직책을 가진 분이 있습니다." };
  if (err?.code === "23505") {
    // Tell which unique value collided instead of always blaming the phone.
    const m = err.message ?? "";
    if (m.includes("phone")) return { ok: false, error: "이미 등록된 휴대폰 번호입니다." };
    if (m.includes("email")) return { ok: false, error: "이미 등록된 메일 주소입니다." };
    return { ok: false, error: "이미 등록된 값입니다. 입력 내용을 확인해 주세요." };
  }
  const code = errorCode(err?.message);
  return { ok: false, error: ADMIN_ERRORS[code] ?? errorMessage(code) };
}

/** Normalize a US-style phone number to E.164 (+1XXXXXXXXXX); keep other +codes. */
function toE164(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (/^\+[1-9]\d{6,14}$/.test(digits)) return digits;
  const d = digits.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

export async function createPerson(formData: FormData): Promise<AdminResult> {
  const phone = toE164(String(formData.get("phone") ?? ""));
  if (!phone) return { ok: false, error: "휴대폰 번호를 확인해 주세요. 예: (213) 555-0100" };
  const fields = z
    .object({
      name: z.string().trim().min(1).max(50),
      legalNameEn: z.string().trim().max(100),
      email: z.email().max(254).or(z.literal("")),
      title: z.string().trim().max(20),
    })
    .safeParse({
      name: String(formData.get("name") ?? ""),
      legalNameEn: String(formData.get("legalNameEn") ?? ""),
      email: String(formData.get("email") ?? "").trim(),
      title: String(formData.get("title") ?? ""),
    });
  if (!fields.success) return invalid;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_create_person", {
    p_name: fields.data.name,
    p_legal_name_en: fields.data.legalNameEn,
    p_phone_e164: phone,
    p_email: fields.data.email,
    p_church_title: fields.data.title,
    p_needs_in_person_check: formData.get("approver") === "on",
  });
  if (error) return fail(error);
  revalidatePath("/admin");
  return { ok: true };
}

export async function createInvite(personId: string): Promise<AdminResult> {
  if (!id.safeParse(personId).success) return invalid;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_invite", { p_person: personId });
  if (error || !data) return fail(error);
  return { ok: true, value: `${serverEnv.appOrigin}/invite/${data}` };
}

export async function confirmInPerson(personId: string): Promise<AdminResult> {
  if (!id.safeParse(personId).success) return invalid;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_confirm_in_person", { p_person: personId });
  if (error) return fail(error);
  revalidatePath("/admin");
  return { ok: true };
}

export async function suspendPerson(personId: string): Promise<AdminResult> {
  if (!id.safeParse(personId).success) return invalid;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_person_status", { p_person: personId, p_status: "suspended" });
  if (error) return fail(error);
  revalidatePath("/admin");
  return { ok: true };
}

export async function reactivatePerson(personId: string): Promise<AdminResult> {
  if (!id.safeParse(personId).success) return invalid;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reactivate_person", { p_person: personId });
  if (error) return fail(error);
  revalidatePath("/admin");
  return { ok: true };
}

const positionSchema = z.object({
  person: z.guid(),
  department: z.guid(),
  role: z.enum(["dept_head", "elder", "finance", "finance_elder"]),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
});

export async function assignPosition(formData: FormData): Promise<AdminResult> {
  const parsed = positionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid;
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_assign_position", {
    p_person: v.person,
    p_department: v.department,
    p_role: v.role,
    p_starts_on: v.startsOn,
    p_ends_on: v.endsOn || (null as unknown as string),
  });
  if (error) return fail(error);
  revalidatePath("/admin");
  return { ok: true };
}

export async function createDepartment(formData: FormData): Promise<AdminResult> {
  const parent = String(formData.get("parent") ?? "");
  if (parent && !id.safeParse(parent).success) return invalid;
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 50 || String(formData.get("nameEn") ?? "").length > 80) return invalid;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_create_department", {
    p_name: String(formData.get("name") ?? ""),
    p_name_en: String(formData.get("nameEn") ?? ""),
    p_parent: parent || (null as unknown as string),
    p_is_finance: formData.get("isFinance") === "on",
  });
  if (error) return fail(error);
  revalidatePath("/admin");
  return { ok: true };
}

export async function reassignStep(claimId: string, version: number, reason: string): Promise<AdminResult> {
  const ok = z
    .object({ claimId: z.guid(), version: z.number().int().min(0), reason: z.string().trim().min(1).max(300) })
    .safeParse({ claimId, version, reason });
  if (!ok.success) return { ok: false, error: ADMIN_ERRORS.reason_required };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reassign_current_step", {
    p_claim: claimId,
    p_version: version,
    p_reason: reason,
  });
  if (error) return fail(error);
  after(() => dispatchClaimNotifications(claimId));
  revalidatePath("/admin");
  return { ok: true };
}
