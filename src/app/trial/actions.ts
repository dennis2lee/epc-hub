"use server";

import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { MAX_RECEIPT_BYTES, sniffReceiptType } from "@/lib/server/file-type";
import { trialPagesEnabled } from "@/lib/server/trial";

export type UploadResult =
  | { ok: true; name: string; mime: string; bytes: number; sha256: string; path: string }
  | { ok: false; error: string };


/**
 * Trial upload: the server receives the file, computes its SHA-256 and stores it
 * with the user's own session (RLS on storage.objects applies). The same path is
 * used for real receipts in M2.
 */
export async function uploadTrialFile(formData: FormData): Promise<UploadResult> {
  if (!trialPagesEnabled()) return { ok: false, error: "시험 기간이 끝났습니다." };
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return { ok: false, error: "먼저 로그인해 주세요." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "파일이 없습니다." };
  if (file.size > MAX_RECEIPT_BYTES) return { ok: false, error: `파일이 너무 큽니다 (${file.size} bytes, 최대 4MB).` };

  const bytes = Buffer.from(await file.arrayBuffer());
  const type = sniffReceiptType(bytes);
  if (!type) return { ok: false, error: `사진이나 PDF가 아닙니다 (브라우저가 알린 형식: ${file.type || "없음"}).` };
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = `${user.id}/${randomUUID()}.${type.ext}`;

  const { error } = await supabase.storage.from("trial").upload(path, bytes, { contentType: type.mime, upsert: false });
  if (error) return { ok: false, error: "업로드에 실패했습니다." };

  return { ok: true, name: file.name, mime: type.mime, bytes: file.size, sha256, path };
}
