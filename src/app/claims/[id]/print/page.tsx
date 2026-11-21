import { Suspense } from "react";
import { getMe, isActive } from "@/lib/server/session";
import { AccountGate } from "@/app/components/account-gate";
import { formatCents } from "@/lib/money";
import { formatChurchDateTime, formatDay } from "@/lib/time";
import { PrintButton } from "@/app/trial/print/print-button";

export const metadata = { title: "인쇄용 청구서 · 교회 지출청구" };

type Props = { params: Promise<{ id: string }> };

const ROLE: Record<string, string> = { dept_head: "부장", elder: "담당 장로" };
const STATUS: Record<string, string> = {
  draft: "작성 중",
  in_review: "결재 중",
  rejected: "보완 요청",
  approved: "결재 완료",
  received: "서류 확인 완료",
  paid: "수표 발행",
  cancelled: "취소",
};
// Approvals print as binding only when the claim is past approval.
const FINAL = new Set(["approved", "received", "paid"]);
const POLICY = "교회 전자결재 운영 규정 v1 (시범 운영)";

// Printable copy in the paper form's layout (design §7). Only the current
// round's approvals are shown, and an approval counts only if it was given to
// exactly the content printed (snapshot hash, checked in the database).
async function PrintView({ params }: Props) {
  const { id } = await params;
  const { me, supabase } = await getMe();
  if (!isActive(me)) return <AccountGate me={me} next={`/claims/${id}/print`} />;

  const { data: claim } = await supabase.from("claims").select("*").eq("id", id).maybeSingle();
  if (!claim || !claim.claim_no) return <p>이 청구서를 볼 수 없습니다.</p>;

  const [{ data: lines }, { data: steps }, { data: dept }, { data: author }, { data: pays }, { data: atts }, { data: returns }] =
    await Promise.all([
      supabase.from("claim_lines").select("*").eq("claim_id", id).order("sort_order"),
      supabase.rpc("claim_print_steps", { p_claim: id }),
      supabase.from("departments").select("name, name_en").eq("id", claim.department_id).maybeSingle(),
      supabase.from("people").select("name").eq("id", claim.author_id).maybeSingle(),
      supabase.from("payment_claims").select("payment_id").eq("claim_id", id),
      supabase.from("attachments").select("id").eq("claim_id", id),
      supabase.from("claim_returns").select("id").eq("claim_id", id),
    ]);
  const peopleIds = [claim.received_by].filter(Boolean) as string[];
  const paymentIds = (pays ?? []).map((p) => p.payment_id);
  const [{ data: payments }, { data: people }] = await Promise.all([
    paymentIds.length
      ? supabase.from("payments").select("check_no, issued_on, status, amount_cents, paid_by, cleared_on").in("id", paymentIds)
      : Promise.resolve({ data: [] }),
    peopleIds.length ? supabase.from("people").select("id, name").in("id", peopleIds) : Promise.resolve({ data: [] }),
  ]);
  const payment = (payments ?? []).find((p) => p.status !== "void");
  const voided = (payments ?? []).filter((p) => p.status === "void");
  const payerIds = payment ? [payment.paid_by] : [];
  const { data: payers } = payerIds.length ? await supabase.from("people").select("id, name").in("id", payerIds) : { data: [] };
  const nameOf = new Map([...(people ?? []), ...(payers ?? [])].map((p) => [p.id, p.name]));
  const final = FINAL.has(claim.status);
  const priorRejections = (returns ?? []).length + Math.max(0, claim.round - 1);

  const cell = { border: "1.5px solid var(--ink)", padding: "6px 10px", textAlign: "center" as const };

  return (
    <div className="stack" style={{ position: "relative" }}>
      {!final && (
        <p className="notice" style={{ fontSize: "1.3rem", fontWeight: 700, textAlign: "center" }}>
          {STATUS[claim.status] ?? claim.status} — 결재 효력 없음 · NOT APPROVED
        </p>
      )}
      <h1 className="title">
        지출청구서 <span className="en">Expense Claim</span> · {claim.claim_no}
      </h1>
      <p className="muted">
        상태 {STATUS[claim.status] ?? claim.status} · {claim.round}회차
        {priorRejections > 0 ? ` · 이전 보완 요청·반송 ${priorRejections}회` : ""}
      </p>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          <tr>
            <th style={cell}>작성 · Submitted by</th>
            {(steps ?? []).map((s) => (
              <th key={s.step_id} style={cell}>
                {s.roles.map((r) => ROLE[r] ?? r).join("·")}
              </th>
            ))}
            <th style={cell}>재정부 확인 · Finance</th>
          </tr>
          <tr>
            <td style={cell}>
              {author?.name}
              <br />
              <small>{claim.submitted_at ? formatChurchDateTime(claim.submitted_at) : ""}</small>
            </td>
            {(steps ?? []).map((s) => (
              <td key={s.step_id} style={cell}>
                {s.valid ? (
                  <>
                    승인
                    <br />
                    {s.acted_by_name ? `${s.acted_by_name} (대결, ${s.approver_name} 차례)` : s.approver_name}
                    <br />
                    <small>
                      {s.decided_at ? formatChurchDateTime(s.decided_at) : ""} · {s.snapshot8}
                    </small>
                  </>
                ) : (
                  // Undecided or no longer valid: an empty box, never a name that looks like a signature.
                  <span className="muted">—</span>
                )}
              </td>
            ))}
            <td style={cell}>
              {claim.received_at && claim.received_by ? (
                <>
                  확인
                  <br />
                  {nameOf.get(claim.received_by)}
                  <br />
                  <small>{formatChurchDateTime(claim.received_at)}</small>
                </>
              ) : (
                <span className="muted">—</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      <dl className="kv">
        <dt>부서 · Department</dt>
        <dd>
          {dept?.name}
          {dept?.name_en ? ` · ${dept.name_en}` : ""}
        </dd>
        <dt>사용 목적 · Purpose</dt>
        <dd>{claim.purpose}</dd>
        {claim.attendees && (
          <>
            <dt>참석자 · Attendees</dt>
            <dd>{claim.attendees}</dd>
          </>
        )}
        <dt>사용일 · Date</dt>
        <dd>{formatDay(claim.expense_date)}</dd>
        <dt>수표 수취인 · Payee</dt>
        <dd>{claim.payee_name}</dd>
        <dt>수령 · Delivery</dt>
        <dd>{claim.check_delivery === "mail" ? "우편 · Mail" : "주일 수령 · Pickup"}</dd>
        <dt>영수증 · Receipts</dt>
        <dd>{(atts ?? []).length}장 (현재 첨부 기준)</dd>
        {payment && (
          <>
            <dt>수표 · Check</dt>
            <dd>
              #{payment.check_no} · {formatCents(Number(payment.amount_cents))} · 발행 {formatDay(payment.issued_on)} · 기록{" "}
              {nameOf.get(payment.paid_by)}
              {payment.cleared_on ? ` · 결제 ${formatDay(payment.cleared_on)}` : ""}
            </dd>
          </>
        )}
        {voided.length > 0 && (
          <>
            <dt>무효 수표 · Void</dt>
            <dd>{voided.map((v) => `#${v.check_no}`).join(", ")}</dd>
          </>
        )}
      </dl>

      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...cell, textAlign: "left" }}>항목 · Item</th>
            <th style={{ ...cell, textAlign: "right" }}>금액 · Amount</th>
          </tr>
        </thead>
        <tbody>
          {(lines ?? []).map((l) => (
            <tr key={l.id}>
              <td style={{ ...cell, textAlign: "left" }}>{l.description}</td>
              <td style={{ ...cell, textAlign: "right" }}>{formatCents(Number(l.amount_cents))}</td>
            </tr>
          ))}
          <tr>
            <th style={{ ...cell, textAlign: "left" }}>합계 · Total</th>
            <th style={{ ...cell, textAlign: "right" }}>{formatCents(Number(claim.total_cents))}</th>
          </tr>
        </tbody>
      </table>
      <p className="muted">
        {[
          claim.single_approver && "결재자 1인(작성자 제외)",
          claim.solo_admin_period && "관리자 1인 기간",
          claim.late && "사용일 60일 경과",
          claim.dup_warning && `중복 의심${claim.dup_note ? `(확인: ${claim.dup_note})` : ""}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="muted">
        출력 {formatChurchDateTime(new Date())} · 근거: {POLICY} · 승인 칸의 8자리는 승인 당시 내용의 확인값입니다.
      </p>
      <PrintButton />
    </div>
  );
}

export default function PrintPage(props: Props) {
  return (
    <main className="page" style={{ maxWidth: 800 }}>
      <Suspense fallback={<p className="muted">불러오는 중…</p>}>
        <PrintView {...props} />
      </Suspense>
    </main>
  );
}
