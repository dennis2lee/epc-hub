"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeReceipt, uploadReceipt } from "../actions";

type Attachment = { id: string; mime: string; url: string };

const MAX_SIDE = 1600;

/**
 * Shrink photos on the phone (long side 1600px, JPEG 80%) before upload. HEIC
 * is converted too where the browser can decode it (Safari); otherwise the
 * server refuses it with a clear message (decision D17).
 */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const heic = file.type === "image/heic" || file.type === "image/heif";
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (!blob || (!heic && blob.size >= file.size)) return file;
    return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Picking a photo uploads it at once; there is no second "upload" button. */
export function ReceiptUploader({ claimId, attachments }: { claimId: string; attachments: Attachment[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files ?? []);
    if (files.length === 0) return;
    setMessage(null);
    start(async () => {
      for (const file of files) {
        const fd = new FormData();
        fd.set("claimId", claimId);
        fd.set("file", await shrinkImage(file));
        const r = await uploadReceipt(fd).catch(() => ({
          ok: false as const,
          error: "올리지 못했습니다. 파일이 너무 크거나 연결이 끊겼습니다.\nUpload failed: the file is too large or the connection dropped.",
        }));
        if (!r.ok) {
          setMessage(r.error);
          break;
        }
      }
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });
  }

  function onRemove(id: string) {
    start(async () => {
      const r = await removeReceipt(id);
      if (!r.ok) setMessage(r.error);
      router.refresh();
    });
  }

  return (
    <section className="card stack">
      <h2 className="subtitle">
        2. 영수증 사진 <span className="en">Receipt photos</span>
      </h2>
      {attachments.length > 0 && (
        <div className="thumbs">
          {attachments.map((a, i) => (
            <div key={a.id} className="stack" style={{ gap: 4 }}>
              <a href={a.url}>
                {a.mime.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt={`영수증 ${i + 1}`} />
                ) : (
                  `PDF ${i + 1}`
                )}
              </a>
              <button type="button" className="chip" onClick={() => onRemove(a.id)} disabled={pending}>
                빼기 <span className="en">Remove</span>
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="muted" aria-live="polite">
        {attachments.length > 0 ? `영수증 ${attachments.length}장이 들어 있습니다. · ${attachments.length} attached.` : "아직 없습니다. · None yet."}
      </p>
      <label className={`btn ${attachments.length === 0 ? "btn-main" : "btn-ghost"}`} aria-disabled={pending}>
        {pending ? "넣는 중…" : attachments.length === 0 ? "영수증 사진 넣기" : "영수증 더 넣기"}{" "}
        <span className="en">{attachments.length === 0 ? "Add receipt photo" : "Add another"}</span>
        <input
          ref={inputRef}
          id="receipt-file"
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="visually-hidden"
          onChange={onPick}
          disabled={pending}
        />
      </label>
      {message && (
        <p className="notice" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}
