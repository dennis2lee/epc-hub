"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeReceipt, uploadReceipt } from "../actions";

type Attachment = { id: string; mime: string; merchant: string | null; url: string | null };

const MAX_SIDE = 1600;

/** Shrink photos on the phone (long side 1600px, JPEG 80%) before upload. */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/heic" || file.type === "image/heif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export function ReceiptUploader({ claimId, attachments }: { claimId: string; attachments: Attachment[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    setMessage(null);
    start(async () => {
      const file = fd.get("file");
      if (file instanceof File && file.size > 0) fd.set("file", await shrinkImage(file));
      fd.set("claimId", claimId);
      const r = await uploadReceipt(fd).catch(() => ({ ok: false as const, error: "올리지 못했습니다. 파일이 너무 크거나 연결이 끊겼습니다." }));
      if (!r.ok) {
        setMessage(r.error);
        return;
      }
      formEl.reset();
      router.refresh();
    });
  }

  function onRemove(id: string) {
    start(async () => {
      const r = await removeReceipt(id, claimId);
      if (!r.ok) setMessage(r.error);
      router.refresh();
    });
  }

  return (
    <section className="card stack">
      <h2 className="subtitle">
        2. 영수증 <span className="en">Receipts</span>
      </h2>
      <div className="thumbs">
        {attachments.map((a, i) => (
          <div key={a.id} className="stack" style={{ gap: 4 }}>
            <a href={a.url ?? "#"} target="_blank" rel="noreferrer">
              {a.mime.startsWith("image/") && a.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.url} alt={`영수증 ${i + 1}`} />
              ) : (
                `영수증 ${i + 1}`
              )}
            </a>
            <button type="button" className="chip" onClick={() => onRemove(a.id)} disabled={pending}>
              지우기
            </button>
          </div>
        ))}
      </div>
      <form onSubmit={onUpload} className="stack">
        <input id="receipt-file" name="file" type="file" accept="image/*,application/pdf" required />
        <label className="field">
          <span className="muted">가게 이름 (선택)</span>
          <input id="receipt-merchant" name="merchant" maxLength={100} />
        </label>
        <div className="btn-row">
          <label className="field">
            <span className="muted">영수증 날짜 (선택)</span>
            <input id="receipt-date" name="receiptDate" type="date" />
          </label>
          <label className="field">
            <span className="muted">영수증 금액 (선택)</span>
            <input id="receipt-amount" name="amount" inputMode="decimal" placeholder="0.00" />
          </label>
        </div>
        {message && <p className="notice">{message}</p>}
        <button className="btn btn-ghost" disabled={pending}>
          {pending ? "올리는 중…" : "영수증 올리기"} <span className="en">Add receipt</span>
        </button>
      </form>
    </section>
  );
}
