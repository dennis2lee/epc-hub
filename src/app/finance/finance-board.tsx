"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/money";
import { formatDay } from "@/lib/time";
import { markCleared, recordPayment, unmarkCleared, voidPayment } from "./actions";

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
  paid_by_name: string | null;
  cleared_by_name: string | null;
  self_cleared: boolean;
  voided_by_name: string | null;
  void_reason: string | null;
  replaces_check_no: string | null;
  can_clear: boolean;
  can_void: boolean;
  can_unclear: boolean;
};

type Props = {
  today: string;
  month: string;
  canAct: boolean;
  readOnlyReason: string | null;
  queue: QueueRow[];
  payments: Payment[];
};

function Flags({ r }: { r: QueueRow }) {
  return (
    <span className="muted">
      {r.single_approver ? " · 결재자 1인" : ""}
      {r.dup_warning ? " · 중복 의심" : ""}
      {r.late ? " · 60일 경과" : ""}
    </span>
  );
}

type RowAction = { paymentId: string; kind: "clear" | "void" | "unclear"; value: string };

export function FinanceBoard({ today, month, canAct, readOnlyReason, queue, payments }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [checkNo, setCheckNo] = useState("");
  const [amount, setAmount] = useState("");
  const [issuedOn, setIssuedOn] = useState(today);
  const [memo, setMemo] = useState("");
  const [exportMonth, setExportMonth] = useState(month);
  const [message, setMessage] = useState<{ text: string; ok: boolean; where: string } | null>(null);
  const [rowAction, setRowAction] = useState<RowAction | null>(null);
  const [pending, start] = useTransition();

  const toVerify = queue.filter((q) => q.status === "approved");
  const toPay = queue.filter((q) => q.status === "received");
  const selectedRows = toPay.filter((q) => selected.includes(q.claim_id));
  const selectedTotal = selectedRows.reduce((s, r) => s + Number(r.total_cents), 0);
  // A check pays one payee: only claims by the first selected author can be added.
  const lockedAuthor = selectedRows[0]?.author_id;
  const lockedDelivery = selectedRows[0]?.check_delivery;
  const outstanding = payments.filter((p) => p.status === "issued");

  function say(where: string, r: { ok: boolean; error?: string }, okText: string) {
    setMessage({ where, ok: r.ok, text: r.ok ? okText : (r.error ?? "") });
  }
  function msg(where: string) {
    if (message?.where !== where) return null;
    return (
      <p className={message.ok ? "ok" : "notice"} role={message.ok ? "status" : "alert"}>
        {message.text}
      </p>
    );
  }

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function onRecord(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    start(async () => {
      const r = await recordPayment({ claims: selected, checkNo, issuedOn, amount, memo });
      say("pay", r, "수표를 기록했습니다. 받는 분께 메일로 알립니다.");
      if (r.ok) {
        setSelected([]);
        setCheckNo("");
        setAmount("");
        setMemo("");
      }
      router.refresh();
    });
  }

  function onRowAction(p: Payment) {
    if (!rowAction) return;
    const a = rowAction;
    start(async () => {
      const r =
        a.kind === "clear"
          ? await markCleared(p.payment_id, a.value)
          : a.kind === "void"
            ? await voidPayment(p.payment_id, a.value)
            : await unmarkCleared(p.payment_id, a.value);
      say(
        "checks",
        r,
        a.kind === "clear"
          ? `#${p.check_no} 결제일을 기록했습니다.`
          : a.kind === "void"
            ? `#${p.check_no}를 무효 처리했습니다. 청구서는 다시 수표 발행 대기로 돌아갔습니다.`
            : `#${p.check_no} 결제 기록을 취소했습니다.`,
      );
      if (r.ok) setRowAction(null);
      router.refresh();
    });
  }

  return (
    <div className="stack">
      {readOnlyReason && (
        <p className="notice" role="status">
          {readOnlyReason}
        </p>
      )}

      {canAct && (
        <section className="card stack">
          <h2 className="subtitle">
            서류 확인 대기 {toVerify.length}건 <span className="en">To verify</span>
          </h2>
          {toVerify.length === 0 && <p className="muted">없습니다. 본인 청구와 본인이 결재한 청구는 다른 분이 처리합니다.</p>}
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
                  <label className="choice" style={{ opacity: disabled ? 0.5 : 1 }}>
                    <input
                      type="checkbox"
                      checked={selected.includes(r.claim_id)}
                      disabled={disabled}
                      onChange={() => toggle(r.claim_id)}
                    />
                    <span>
                      <Link href={`/claims/${r.claim_id}`}>{r.claim_no}</Link> · {r.author} ·{" "}
                      {r.check_delivery === "mail" ? "우편" : "주일 수령"}
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
                  <span>수표 번호 (숫자만)</span>
                  <input
                    id="check-no"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    required
                    value={checkNo}
                    onChange={(e) => setCheckNo(e.target.value)}
                    maxLength={10}
                  />
                </label>
                <label className="field">
                  <span>발행일</span>
                  <input id="check-date" type="date" max={today} required value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
                </label>
              </div>
              <label className="field">
                <span>수표에 쓴 금액 ($) · 합계와 같아야 합니다</span>
                <input id="check-amount" inputMode="decimal" required placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} maxLength={20} />
              </label>
              <label className="field">
                <span>메모 (선택)</span>
                <input id="check-memo" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={300} />
              </label>
              {msg("pay")}
              <button className="btn btn-main" disabled={pending}>
                수표 기록 <span className="en">Record check</span>
              </button>
            </form>
          )}
          {selected.length === 0 && msg("pay")}
        </section>
      )}

      <section className="card stack">
        <h2 className="subtitle">
          수표 목록 · 은행 결제 전 {outstanding.length}장 <span className="en">Checks</span>
        </h2>
        {payments.length === 0 && <p className="muted">최근 수표가 없습니다.</p>}
        <ul className="list">
          {payments.map((p) => (
            <li key={p.payment_id} className="stack" style={{ padding: "10px 0", gap: 6 }}>
              <div className="row-link" style={{ padding: 0 }}>
                <span>
                  #{p.check_no} · {p.payee_name} · {formatDay(p.issued_on)}
                  <br />
                  <span className="muted">
                    {p.claim_nos} · 기록 {p.paid_by_name}
                    {p.replaces_check_no ? ` · #${p.replaces_check_no} 재발행` : ""}
                  </span>
                </span>
                <span style={{ textAlign: "right" }}>
                  <strong style={{ textDecoration: p.status === "void" ? "line-through" : undefined }}>
                    {formatCents(Number(p.amount_cents))}
                  </strong>
                  <br />
                  <span className="muted">
                    {p.status === "issued" && "결제 전"}
                    {p.status === "cleared" && `결제 ${formatDay(p.cleared_on)} · ${p.cleared_by_name ?? ""}${p.self_cleared ? " (발행자 본인)" : ""}`}
                    {p.status === "void" && `무효 · ${p.voided_by_name ?? ""}`}
                  </span>
                </span>
              </div>
              {p.status === "void" && p.void_reason && <span className="muted">무효 사유: {p.void_reason}</span>}
              {rowAction?.paymentId === p.payment_id ? (
                <div className="stack">
                  <label className="field">
                    <span>
                      {rowAction.kind === "clear" ? "은행 명세서의 결제일" : rowAction.kind === "void" ? "무효 사유 (5자 이상)" : "취소 사유 (5자 이상)"}
                    </span>
                    <input
                      id={`row-${rowAction.kind}-${p.payment_id}`}
                      type={rowAction.kind === "clear" ? "date" : "text"}
                      max={rowAction.kind === "clear" ? today : undefined}
                      maxLength={300}
                      value={rowAction.value}
                      onChange={(e) => setRowAction({ ...rowAction, value: e.target.value })}
                    />
                  </label>
                  {rowAction.kind === "void" && (
                    <p className="muted">무효로 하면 이 번호는 다시 쓸 수 없고, 묶인 청구서는 수표 발행 대기로 돌아갑니다.</p>
                  )}
                  <div className="btn-row">
                    <button type="button" className="btn btn-ghost" onClick={() => setRowAction(null)} disabled={pending}>
                      돌아가기
                    </button>
                    <button
                      type="button"
                      className={rowAction.kind === "void" ? "btn btn-danger" : "btn btn-main"}
                      onClick={() => onRowAction(p)}
                      disabled={pending || !rowAction.value.trim()}
                    >
                      {rowAction.kind === "clear" ? "결제일 기록" : rowAction.kind === "void" ? "무효 처리" : "결제 기록 취소"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="chips">
                  {p.can_clear && (
                    <button type="button" className="chip" disabled={pending} onClick={() => setRowAction({ paymentId: p.payment_id, kind: "clear", value: today })}>
                      결제됨 기록
                    </button>
                  )}
                  {p.can_void && (
                    <button type="button" className="chip" disabled={pending} onClick={() => setRowAction({ paymentId: p.payment_id, kind: "void", value: "" })}>
                      무효 처리
                    </button>
                  )}
                  {p.can_unclear && (
                    <button type="button" className="chip" disabled={pending} onClick={() => setRowAction({ paymentId: p.payment_id, kind: "unclear", value: "" })}>
                      결제 기록 취소
                    </button>
                  )}
                  {p.status === "issued" && !p.can_clear && canAct && (
                    <span className="muted">결제 확인은 수표를 기록하지 않은 다른 재정부원이 합니다.</span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {msg("checks")}
      </section>

      <section className="card stack">
        <h2 className="subtitle">
          월별 CSV <span className="en">Monthly export</span>
        </h2>
        <label className="field">
          <span>월 (수표 발행월 기준)</span>
          <input id="export-month" type="month" value={exportMonth} onChange={(e) => setExportMonth(e.target.value)} />
        </label>
        <a className="btn btn-ghost" href={`/api/finance/export?month=${encodeURIComponent(exportMonth)}`}>
          지급 내역 CSV <span className="en">Payments</span>
        </a>
        <a className="btn btn-ghost" href="/api/finance/export?kind=outstanding">
          오늘 기준 미지급·미결제 CSV <span className="en">Outstanding</span>
        </a>
        <p className="muted">카톡 안에서 받아지지 않으면 외부 브라우저나 PC에서 열어 주세요.</p>
      </section>
    </div>
  );
}
