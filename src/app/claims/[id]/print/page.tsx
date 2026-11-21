import { Suspense } from "react";
import { getMe, isActive } from "@/lib/server/session";
import { AccountGate } from "@/app/components/account-gate";
import { formatCents } from "@/lib/money";
import { formatChurchDateTime } from "@/lib/time";
import { PrintButton } from "@/app/trial/print/print-button";

export const metadata = { title: "인쇄용 청구서 · 교회 지출청구" };

type Props = { params: Promise<{ id: string }> };

const ROLE: Record<string, string> = { dept_head: "부장", elder: "담당 장로" };

// Printable copy in the paper form's layout (design §7). Only the final round's
// approvals are shown; earlier rounds stay on screen and in the audit log.
async function PrintView({ params }: Props) {
  const { id } = await params;
  const { me, supabase } = await getMe();
  if (!isActive(me)) return <AccountGate me={me} next={`/claims/${id}/print`} />;

  const { data: claim } = await supabase.from("claims").select("*").eq("id", id).maybeSingle();
  if (!claim || !claim.claim_no) return <p>이 청구서를 볼 수 없습니다.</p>;

  const [{ data: lines }, { data: steps }, { data: dept }, { data: author }, { data: pays }, { data: atts }] = await Promise.all([
    supabase.from("claim_lines").select("*").eq("claim_id", id).order("sort_order"),
    supabase.from("approval_steps").select("*").eq("claim_id", id).eq("round", claim.round).order("seq"),
    supabase.from("departments").select("name, name_en").eq("id", claim.department_id).maybeSingle(),
    supabase.from("people").select("name").eq("id", claim.author_id).maybeSingle(),
    supabase.from("payment_claims").select("payment_id").eq("claim_id", id),
    supabase.from("attachments").select("id").eq("claim_id", id),
  ]);
  const ids = [...new Set((steps ?? []).flatMap((s) => [s.approver_id, s.acted_by].filter(Boolean) as string[]))];
  const { data: people } = ids.length ? await supabase.from("people").select("id, name").in("id", ids) : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.name]));
  const paymentIds = (pays ?? []).map((p) => p.payment_id);
  const { data: payments } = paymentIds.length
    ? await supabase.from("payments").select("check_no, issued_on, status").in("id", paymentIds)
    : { data: [] };
  const payment = (payments ?? []).find((p) => p.status !== "void");

  const cell = { border: "1.5px solid var(--ink)", padding: "6px 10px", textAlign: "center" as const };

  return (
    <div className="stack">
      <h1 className="title">
        지출청구서 <span className="en">Expense Claim</span> · {claim.claim_no}
      </h1>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          <tr>
            <th style={cell}>작성 · Submitted by</th>
            {(steps ?? []).map((s) => (
              <th key={s.id} style={cell}>
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
              <td key={s.id} style={cell}>
                {s.decision === "approve" ? "승인" : s.decision === "reject" ? "보완 요청" : "대기"}
                <br />
                {nameOf.get(s.acted_by ?? s.approver_id)}
                <br />
                <small>{s.decided_at ? formatChurchDateTime(s.decided_at) : ""}</small>
              </td>
            ))}
            <td style={cell}>
              {claim.received_at ? "확인" : "대기"}
              <br />
              <small>{claim.received_at ? formatChurchDateTime(claim.received_at) : ""}</small>
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
        <dd>{claim.expense_date}</dd>
        <dt>수표 수취인 · Payee</dt>
        <dd>{claim.payee_name}</dd>
        <dt>수령 · Delivery</dt>
        <dd>{claim.check_delivery === "mail" ? "우편 · Mail" : "주일 수령 · Pickup"}</dd>
        <dt>영수증 · Receipts</dt>
        <dd>{(atts ?? []).length}</dd>
        {payment && (
          <>
            <dt>수표 · Check</dt>
            <dd>
              #{payment.check_no} · {payment.issued_on}
            </dd>
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
        {claim.single_approver ? "결재자 1인(작성자 제외) · " : ""}
        출력 {formatChurchDateTime(new Date())} · 근거: 교회 전자결재 운영 규정
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
