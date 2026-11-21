"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { actOnClaim } from "../actions";

type Props = {
  claimId: string;
  version: number;
  amount: string;
  payee: string;
  receiptCount: number;
  reasons: string[];
};

/** Approve with a confirmation sheet, or request changes with a reason chip. */
export function ApproverPanel({ claimId, version, amount, payee, receiptCount, reasons }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "approve" | "reject" | "done">("idle");
  const [reason, setReason] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(decision: "approve" | "reject") {
    setMessage(null);
    const fullReason = decision === "reject" ? [reason, memo.trim()].filter(Boolean).join(" · ") : "";
    if (decision === "reject" && (!reason || (reason === "기타" && !memo.trim()))) {
      setMessage(reason === "기타" ? "기타를 고르셨으면 메모를 적어 주세요." : "사유를 골라 주세요.");
      return;
    }
    start(async () => {
      const r = await actOnClaim(claimId, version, decision, fullReason);
      if (!r.ok) {
        setMessage(r.error);
        return;
      }
      setMode("done");
      if (r.message) setMessage(r.message);
      // The server then shows the lasting result card (who was notified next).
      router.refresh();
    });
  }

  if (mode === "done") {
    return (
      <section className="card stack">
        <p className="subtitle" role="status">
          처리했습니다. <span className="en">Done.</span>
        </p>
        {message && <p className="notice">{message}</p>}
      </section>
    );
  }

  return (
    <section className="card stack">
      {mode === "idle" && (
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={() => setMode("reject")}>
            보완 요청 <span className="en">Request changes</span>
          </button>
          <button type="button" className="btn btn-main" onClick={() => setMode("approve")}>
            승인 <span className="en">Approve</span>
          </button>
        </div>
      )}

      {mode === "approve" && (
        <div className="stack">
          <p className="subtitle">
            {amount} · {payee} 앞 수표 · 영수증 {receiptCount}장을 승인합니다
            <br />
            <span className="en">
              Approve {amount}, check to {payee}, {receiptCount} receipt(s)
            </span>
          </p>
          <p className="muted">
            승인하면 되돌릴 수 없습니다. 잘못 누르셨으면 돌아가기를 누르세요. · Approval cannot be undone.
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" onClick={() => setMode("idle")} disabled={pending}>
              돌아가기
            </button>
            <button type="button" className="btn btn-main" onClick={() => run("approve")} disabled={pending}>
              {pending ? "처리 중…" : "승인하기"} <span className="en">Approve</span>
            </button>
          </div>
        </div>
      )}

      {mode === "reject" && (
        <div className="stack">
          <p className="subtitle">
            보완 요청 사유 <span className="en">Reason</span>
          </p>
          <p className="muted">작성자에게 메일로 알립니다. · The author will be notified.</p>
          <div className="chips">
            {reasons.map((r) => (
              <button key={r} type="button" className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="muted">
              메모 {reason === "기타" ? "(필수)" : "(선택)"} <span className="en">Note</span>
            </span>
            <input id="reject-memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} />
          </label>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" onClick={() => setMode("idle")} disabled={pending}>
              돌아가기
            </button>
            <button type="button" className="btn btn-main" onClick={() => run("reject")} disabled={pending}>
              {pending ? "처리 중…" : "보완 요청 보내기"} <span className="en">Send</span>
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className="notice" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}
