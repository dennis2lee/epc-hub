"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/money";
import { markCleared, recordPayment } from "./actions";

type QueueRow = {
  claim_id: string;
  claim_no: string | null;
  department: string;
  author: string;
  author_id: string;
  total_cents: number;
  status: string;
  check_delivery: string;
  single_approver: boolean;
  dup_warning: boolean;
  late: boolean;
};
type Payment = {
  payment_id: string;
  check_no: string;
  issued_on: string;
  cleared_on: string | null;
  status: string;
  amount_cents: number;
  payee_name: string;
  claim_nos: string;
  check_delivery: string;
};

type Props = { today: string; month: string; canAct: boolean; queue: QueueRow[]; payments: Payment[] };

function Flags({ r }: { r: QueueRow }) {
  return (
    <span className="muted">
      {r.single_approver ? " · 결재자 1인" : ""}
      {r.dup_warning ? " · 중복 의심" : ""}
      {r.late ? " · 60일 경과" : ""}
    </span>
  );
}

export function FinanceBoard({ today, month, canAct, queue, payments }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [checkNo, setCheckNo] = useState("");
  const [issuedOn, setIssuedOn] = useState(today);
  const [memo, setMemo] = useState("");
  const [exportMonth, setExportMonth] = useState(month);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toVerify = queue.filter((q) => q.status === "approved");
  const toPay = queue.filter((q) => q.status === "received");
  const selectedRows = toPay.filter((q) => selected.includes(q.claim_id));
  const selectedTotal = selectedRows.reduce((s, r) => s + Number(r.total_cents), 0);
  // A check pays one payee: only claims by the first selected author can be added.
  const lockedAuthor = selectedRows[0]?.author_id;
  const lockedDelivery = selectedRows[0]?.check_delivery;

  const outstanding = useMemo(() => payments.filter((p) => p.status === "issued"), [payments]);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function onRecord(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    start(async () => {
      const r = await recordPayment({ claims: selected, checkNo, issuedOn, memo });
      if (!r.ok) {
        setMessage(r.error);
        return;
      }
      setSelected([]);
      setCheckNo("");
      setMemo("");
      setMessage("수표를 기록했습니다. 받는 분께 메일로 알렸습니다.");
      router.refresh();
    });
  }

  function onCleared(paymentId: string) {
    const date = window.prompt("은행 명세서의 결제일 (YYYY-MM-DD)", today);
    if (!date) return;
    start(async () => {
      const r = await markCleared(paymentId, date);
      setMessage(r.ok ? "결제일을 기록했습니다." : r.error);
      router.refresh();
    });
  }

  return (
    <div className="stack">
      {message && <p className="notice">{message}</p>}

      {canAct && (
        <section className="card stack">
          <h2 className="subtitle">
            서류 확인 대기 {toVerify.length}건 <span className="en">To verify</span>
          </h2>
          {toVerify.length === 0 && <p className="muted">없습니다.</p>}
          <ul className="list">
            {toVerify.map((r) => (
              <li key={r.claim_id}>
                <Link href={`/claims/${r.claim_id}`} className="row-link">
                  <span>
                    {r.claim_no} · {r.department} · {r.author}
                    <Flags r={r} />
                  </span>
                  <strong>{formatCents(Number(r.total_cents))}</strong>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canAct && (
        <section className="card stack">
          <h2 className="subtitle">
            수표 발행 대기 {toPay.length}건 <span className="en">To pay</span>
          </h2>
          {toPay.length === 0 && <p className="muted">없습니다.</p>}
          <ul className="list">
            {toPay.map((r) => {
              const disabled = !!lockedAuthor && (r.author_id !== lockedAuthor || r.check_delivery !== lockedDelivery);
              return (
                <li key={r.claim_id} className="row-link">
                  <label style={{ display: "flex", gap: 10, alignItems: "center", opacity: disabled ? 0.5 : 1 }}>
                    <input
                      type="checkbox"
                      checked={selected.includes(r.claim_id)}
                      disabled={disabled}
                      onChange={() => toggle(r.claim_id)}
                    />
                    <span>
                      {r.claim_no} · {r.author} · {r.check_delivery === "mail" ? "우편" : "주일 수령"}
                      <Flags r={r} />
                    </span>
                  </label>
                  <strong>{formatCents(Number(r.total_cents))}</strong>
                </li>
              );
            })}
          </ul>
          {selected.length > 0 && (
            <form onSubmit={onRecord} className="stack">
              <p>
                {selectedRows[0]?.author}님 · {selected.length}건 · 합계 <strong>{formatCents(selectedTotal)}</strong>
              </p>
              <div className="btn-row">
                <label className="field">
                  <span>수표 번호</span>
                  <input id="check-no" inputMode="numeric" required value={checkNo} onChange={(e) => setCheckNo(e.target.value)} maxLength={20} />
                </label>
                <label className="field">
                  <span>발행일</span>
                  <input id="check-date" type="date" max={today} required value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
                </label>
              </div>
              <label className="field">
                <span>메모 (선택)</span>
                <input id="check-memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={300} />
              </label>
              <button className="btn btn-main" disabled={pending}>
                수표 기록 <span className="en">Record check</span>
              </button>
            </form>
          )}
        </section>
      )}

      {canAct && (
        <section className="card stack">
          <h2 className="subtitle">
            은행 결제 전 수표 {outstanding.length}장 <span className="en">Outstanding checks</span>
          </h2>
          <ul className="list">
            {payments.map((p) => (
              <li key={p.payment_id} className="row-link">
                <span>
                  #{p.check_no} · {p.payee_name} · {p.issued_on}
                  <br />
                  <span className="muted">{p.claim_nos}</span>
                </span>
                <span style={{ textAlign: "right" }}>
                  <strong>{formatCents(Number(p.amount_cents))}</strong>
                  <br />
                  {p.status === "issued" ? (
                    <button type="button" className="chip" disabled={pending} onClick={() => onCleared(p.payment_id)}>
                      결제됨 기록
                    </button>
                  ) : (
                    <span className="muted">결제 {p.cleared_on}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card stack">
        <h2 className="subtitle">
          월별 CSV <span className="en">Monthly export</span>
        </h2>
        <label className="field">
          <span>월</span>
          <input id="export-month" type="month" value={exportMonth} onChange={(e) => setExportMonth(e.target.value)} />
        </label>
        <a className="btn btn-ghost" href={`/api/finance/export?month=${encodeURIComponent(exportMonth)}`}>
          CSV 받기
        </a>
        <p className="muted">카톡 안에서 받아지지 않으면 외부 브라우저나 PC에서 열어 주세요.</p>
      </section>
    </div>
  );
}
