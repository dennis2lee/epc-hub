"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { receiveClaim, returnClaim } from "@/app/finance/actions";

type Props = { claimId: string; version: number; dupWarning: boolean; reasons: string[] };

/** Finance verifies documents (no approval) or returns the claim for documents. */
export function FinancePanel({ claimId, version, dupWarning, reasons }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "return">("idle");
  const [dupNote, setDupNote] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onReceive() {
    setMessage(null);
    start(async () => {
      const r = await receiveClaim(claimId, version, dupNote);
      if (!r.ok) setMessage(r.error);
      router.refresh();
    });
  }

  function onReturn() {
    if (!reason || (reason === "기타" && !memo.trim())) {
      setMessage(reason === "기타" ? "기타를 고르셨으면 메모를 적어 주세요." : "사유를 골라 주세요.");
      return;
    }
    start(async () => {
      const r = await returnClaim(claimId, version, [reason, memo.trim()].filter(Boolean).join(" · "));
      if (!r.ok) setMessage(r.error);
      router.refresh();
    });
  }

  return (
    <section className="card stack">
      <h2 className="subtitle">
        재정부 확인 <span className="en">Finance check</span>
      </h2>
      {dupWarning && (
        <label className="field">
          <span>중복 의심: 확인한 내용 (필수)</span>
          <input id="dup-note" value={dupNote} onChange={(e) => setDupNote(e.target.value)} maxLength={300} placeholder="예: 다른 날 같은 가게, 별개 구매 확인" />
        </label>
      )}
      {mode === "idle" ? (
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={() => setMode("return")} disabled={pending}>
            서류 보완 요청
          </button>
          <button type="button" className="btn btn-main" onClick={onReceive} disabled={pending}>
            서류 확인 완료 <span className="en">Verified</span>
          </button>
        </div>
      ) : (
        <div className="stack">
          <div className="chips">
            {reasons.map((r) => (
              <button key={r} type="button" className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="muted">메모 {reason === "기타" ? "(필수)" : "(선택)"}</span>
            <input id="return-memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} />
          </label>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" onClick={() => setMode("idle")} disabled={pending}>
              돌아가기
            </button>
            <button type="button" className="btn btn-main" onClick={onReturn} disabled={pending}>
              보완 요청 보내기
            </button>
          </div>
        </div>
      )}
      {message && <p className="notice">{message}</p>}
    </section>
  );
}
