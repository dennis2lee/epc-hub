"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProfile } from "./actions";

type Initial = { email: string; mailAddress: string; legalNameEn: string; lang: "ko" | "en" };

export function ProfileForm({ initial, back }: { initial: Initial; back: string | null }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await saveProfile(form);
      setMessage(r.ok ? { text: "저장했습니다.\nSaved.", ok: true } : { text: r.error, ok: false });
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="card stack">
      <label className="field">
        <span>
          수표에 쓸 영문 이름 <span className="en">Legal name for checks</span>
        </span>
        <input
          id="profile-legal-name"
          value={form.legalNameEn}
          onChange={(e) => setForm({ ...form, legalNameEn: e.target.value })}
          placeholder="예: Gildong Hong"
          maxLength={100}
        />
        <span className="muted">은행에서 수표를 받을 수 있는 이름과 같아야 합니다. · Must match your bank account name.</span>
      </label>
      <label className="field">
        <span>
          이메일 (알림 받을 주소) <span className="en">Email for notices</span>
        </span>
        <input id="profile-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={254} />
        <span className="muted">주소를 바꾸면 이전 주소로 안내 메일이 갑니다. · The old address is notified.</span>
      </label>
      <label className="field">
        <span>
          수표 우편 주소 <span className="en">Mailing address</span>
        </span>
        <textarea
          id="profile-address"
          rows={3}
          value={form.mailAddress}
          onChange={(e) => setForm({ ...form, mailAddress: e.target.value })}
          maxLength={300}
        />
      </label>
      {/* Screens show Korean and English together; a language switch returns
          with full English screens (decision D18). */}
      {message && (
        <p className={message.ok ? "ok" : "notice"} role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      )}
      <button className="btn btn-main" disabled={pending}>
        저장하기 <span className="en">Save</span>
      </button>
      {back && message?.ok && (
        <button type="button" className="btn btn-main" onClick={() => router.push(back)}>
          쓰던 청구서로 돌아가기 <span className="en">Back to my claim</span>
        </button>
      )}
    </form>
  );
}
