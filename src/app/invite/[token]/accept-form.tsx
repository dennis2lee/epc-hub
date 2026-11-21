"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInvite } from "./actions";

export function AcceptForm({ token, name }: { token: string; name: string }) {
  const router = useRouter();
  const [last4, setLast4] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    start(async () => {
      const r = await acceptInvite(token, last4);
      if (!r.ok) {
        setMessage(r.error);
        return;
      }
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="card stack">
      <p className="subtitle">{name}님 본인이 맞습니까?</p>
      <p className="muted">본인 확인을 위해 교회에 등록된 휴대폰 번호의 마지막 4자리를 넣어 주세요.</p>
      <label className="field">
        <span>휴대폰 번호 마지막 4자리</span>
        <input
          id="invite-last4"
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          required
          value={last4}
          onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))}
        />
      </label>
      {message && <p className="notice">{message}</p>}
      <button className="btn btn-main" disabled={pending}>
        {pending ? "확인 중…" : "네, 본인입니다"}
      </button>
    </form>
  );
}
