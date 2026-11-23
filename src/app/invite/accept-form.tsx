"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInvite } from "./actions";

export function AcceptForm({ name }: { name: string }) {
  const router = useRouter();
  const [last4, setLast4] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    start(async () => {
      const r = await acceptInvite(last4);
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
      <p className="subtitle">
        {name}님 본인이 맞습니까? <span className="en">Are you {name}?</span>
      </p>
      <p className="muted">
        본인 확인을 위해 교회에 등록된 휴대폰 번호의 마지막 4자리를 넣어 주세요.
        <br />
        <span className="en">Enter the last 4 digits of the phone number the church has for you.</span>
      </p>
      <label className="field">
        <span>
          휴대폰 번호 마지막 4자리 <span className="en">Last 4 digits</span>
        </span>
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
        {pending ? "확인 중…" : "네, 본인입니다"} <span className="en">Yes, it&apos;s me</span>
      </button>
    </form>
  );
}
