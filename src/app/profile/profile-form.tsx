"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProfile } from "./actions";

type Initial = { email: string; mailAddress: string; legalNameEn: string; lang: "ko" | "en" };

export function ProfileForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await saveProfile(form);
      setMessage(r.ok ? "저장했습니다." : r.error);
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
        <span className="muted">은행에서 수표를 받을 수 있는 이름과 같아야 합니다.</span>
      </label>
      <label className="field">
        <span>
          이메일 (알림 받을 주소) <span className="en">Email</span>
        </span>
        <input id="profile-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
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
      <label className="field">
        <span>화면 언어 · Language</span>
        <select id="profile-lang" value={form.lang} onChange={(e) => setForm({ ...form, lang: e.target.value as "ko" | "en" })}>
          <option value="ko">한국어</option>
          <option value="en">English</option>
        </select>
      </label>
      {message && <p className="notice">{message}</p>}
      <button className="btn btn-main" disabled={pending}>
        저장하기 <span className="en">Save</span>
      </button>
    </form>
  );
}
