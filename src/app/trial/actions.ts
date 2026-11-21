"use server";

import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

export type UploadResult =
  | { ok: true; name: string; mime: string; bytes: number; sha256: string; path: string }
  | { ok: false; error: string };

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Trial upload: the server receives the file, computes its SHA-256 and stores it
 * with the user's own session (RLS on storage.objects applies). The same path is
 * used for real receipts in M2.
 */
export async function uploadTrialFile(formData: FormData): Promise<UploadResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "파일이 없습니다." };
  if (file.size > MAX_BYTES) return { ok: false, error: `파일이 너무 큽니다 (${file.size} bytes, 최대 5MB).` };

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return { ok: false, error: "먼저 로그인해 주세요." };

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  const path = `${user.id}/${randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from("trial")
    .upload(path, bytes, { contentType: file.type || "application/octet-stream", upsert: false });
  if (error) return { ok: false, error: `업로드 실패: ${error.message}` };

  return { ok: true, name: file.name, mime: file.type, bytes: file.size, sha256, path };
}
