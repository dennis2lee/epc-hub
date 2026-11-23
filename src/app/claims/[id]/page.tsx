import Link from "next/link";
import { Suspense } from "react";
import { canDraft, getMe } from "@/lib/server/session";
import { unreachableSince } from "@/lib/server/notify";
import { AccountGate, CallOffice } from "@/app/components/account-gate";
import { StatusLabel } from "@/app/components/status-label";
import { formatCents } from "@/lib/money";
import { churchDate, formatChurchDateTime, formatDay } from "@/lib/time";
import { DraftEditor } from "./draft-editor";
import { ReceiptUploader } from "./receipt-uploader";
import { ApproverPanel } from "./approver-panel";
import { AuthorActions } from "./author-actions";
import { FinancePanel } from "./finance-panel";

export const metadata = { title: "지출청구서 · 교회 지출청구" };

type Props = { params: Promise<{ id: string }> };

const ROLE_LABEL: Record<string, string> = { dept_head: "부장", elder: "담당 장로" };

async function ClaimView({ params }: Props) {
  const { id } = await params;
  const { me, supabase } = await getMe();
  if (!canDraft(me)) return <AccountGate me={me} next={`/claims/${id}`} />;
  // Pending accounts reach only their own drafts here (the database decides).
  const active = me.status === "active";

  const { data: claim } = await supabase.from("claims").select("*").eq("id", id).maybeSingle();
  if (!claim) {
    return (
      <div className="card stack">
        <p>
          이 청구서를 볼 수 없습니다. 아직 본인 차례가 아니거나, 지워졌거나, 주소가 잘못되었습니다.
          <br />
          <span className="en">You cannot open this claim: it is not your turn yet, it was deleted, or the link is wrong.</span>
        </p>
        <Link className="btn btn-main" href="/">
          홈으로 <span className="en">Home</span>
        </Link>
        <CallOffice />
      </div>
    );
  }

  const [{ data: lines }, { data: attachments }, { data: steps }, { data: dept }, { data: author }, { data: settings }] =
    await Promise.all([
      supabase.from("claim_lines").select("*").eq("claim_id", id).order("sort_order"),
      supabase.from("attachments").select("*").eq("claim_id", id).order("created_at"),
      supabase.from("approval_steps").select("*").eq("claim_id", id).order("round").order("seq"),
      supabase.from("departments").select("id, name").eq("id", claim.department_id).maybeSingle(),
      supabase.from("people").select("id, name").eq("id", claim.author_id).maybeSingle(),
      supabase.from("app_settings").select("value").eq("key", "return_reasons").maybeSingle(),
    ]);

  const approverIds = [...new Set((steps ?? []).map((s) => s.approver_id))];
  const { data: approvers } = approverIds.length
    ? await supabase.from("people").select("id, name").in("id", approverIds)
    : { data: [] };
  const nameOf = new Map((approvers ?? []).map((p) => [p.id, p.name]));

  // Each receipt is opened through a route that signs a fresh URL per request.
  const receiptUrl = (attachmentId: string) => `/claims/${id}/receipts/${attachmentId}`;

  const isAuthor = claim.author_id === me.person_id;
  const isDraft = claim.status === "draft";
  const currentRound = (steps ?? []).filter((s) => s.round === claim.round);
  const currentStep = currentRound.find((s) => s.seq === claim.current_seq);
  const isMyTurn = claim.status === "in_review" && currentStep?.approver_id === me.person_id && !currentStep?.decision;
  const pastRounds = (steps ?? []).filter((s) => s.round < claim.round && s.decision);
  const rejectStep = claim.status === "rejected" ? currentRound.find((s) => s.decision === "reject") : undefined;
  // My own decision in this round stays on screen, with who was told next.
  const myDecision = currentRound.find((s) => s.decision && (s.acted_by ?? s.approver_id) === me.person_id);
  const notifiedNext =
    claim.status === "in_review"
      ? `${nameOf.get(currentStep?.approver_id ?? "") ?? ""}님`
      : claim.status === "approved"
        ? "재정부"
        : claim.status === "rejected"
          ? `작성자 ${author?.name ?? ""}님`
          : null;
  // Only say "we emailed" when every hand-off notice for this step could go out.
  const unreachable = myDecision && !isAuthor ? await unreachableSince(claim.id, claim.updated_at).catch(() => []) : [];

  let preview: { seq: number; roles: string[]; approver_name: string }[] = [];
  let previewError: string | null = null;
  if (isAuthor && isDraft && active) {
    const { data, error } = await supabase.rpc("preview_approval_line", { p_department: claim.department_id });
    preview = data ?? [];
    previewError = error?.message ?? null;
  }
  let departments: { id: string; name: string; name_en: string | null }[] = [];
  if (isAuthor && isDraft) {
    const { data } = await supabase.from("departments").select("id, name, name_en").eq("active", true).order("name");
    departments = data ?? [];
  }
  const reasons = Array.isArray(settings?.value) ? (settings.value as string[]) : ["영수증 누락", "기타"];
  let canFinance = false;
  if (active && (claim.status === "approved" || claim.status === "received")) {
    const { data } = await supabase.rpc("can_i_handle_finance", { p_claim: claim.id });
    canFinance = data === true;
  }

  return (
    <div className="stack">
      <section className="card stack">
        <div className="row-link" style={{ padding: 0 }}>
          <span>
            <strong>{claim.claim_no ?? "작성 중인 청구서"}</strong>
            <br />
            <span className="muted">
              {dept?.name} · {author?.name}
            </span>
          </span>
          <StatusLabel status={claim.status} />
        </div>
        <div className="amount">{formatCents(Number(claim.total_cents))}</div>
        {claim.single_approver && <p className="muted">결재자 1인 (작성자 제외)</p>}
        {rejectStep && (
          <p className="notice">
            보완 요청 ({nameOf.get(rejectStep.approver_id)}): {rejectStep.reason}
          </p>
        )}
        {claim.return_reason && claim.status === "rejected" && (
          <p className="notice">재정부 서류 보완 요청: {claim.return_reason}</p>
        )}
        {currentRound.length > 0 && (
          <div className="steps">
            <div className="done">작성</div>
            {currentRound.map((s) => (
              <div
                key={s.id}
                className={s.decision === "approve" ? "done" : s.seq === claim.current_seq && claim.status === "in_review" ? "now" : ""}
              >
                {s.roles.map((r) => ROLE_LABEL[r] ?? r).join("·")}
                <br />
                {nameOf.get(s.approver_id)}
                {s.decided_at && (
                  <>
                    <br />
                    <small>{formatChurchDateTime(s.decided_at)}</small>
                  </>
                )}
              </div>
            ))}
            <div className={["received", "paid"].includes(claim.status) ? "done" : claim.status === "approved" ? "now" : ""}>
              재정부
            </div>
          </div>
        )}
      </section>

      {isAuthor && isDraft ? (
        <>
          <DraftEditor
            claimId={claim.id}
            version={claim.version}
            round={claim.round}
            departments={departments}
            receiptCount={(attachments ?? []).length}
            legalNameMissing={!me.legal_name_en}
            mailAddressMissing={!me.mail_address}
            preview={preview}
            previewError={previewError}
            accountPending={!active}
            initial={{
              department: claim.department_id,
              purpose: claim.purpose,
              attendees: claim.attendees ?? "",
              expenseDate: claim.expense_date ?? "",
              checkDelivery: claim.check_delivery,
              lines: (lines ?? []).map((l) => ({
                description: l.description,
                amount: (Number(l.amount_cents) / 100).toFixed(2),
                budget_code: l.budget_code ?? "",
              })),
            }}
            today={churchDate()}
          >
            <ReceiptUploader
              claimId={claim.id}
              attachments={(attachments ?? []).map((a) => ({ id: a.id, mime: a.mime, url: receiptUrl(a.id) }))}
            />
          </DraftEditor>
        </>
      ) : (
        <section className="card stack">
          <dl className="kv">
            <dt>사용 목적 · Purpose</dt>
            <dd>{claim.purpose}</dd>
            {claim.attendees && (
              <>
                <dt>참석자</dt>
                <dd>{claim.attendees}</dd>
              </>
            )}
            <dt>사용일</dt>
            <dd>{formatDay(claim.expense_date)}</dd>
            <dt>수표 받는 분 · Payee</dt>
            <dd>{claim.payee_name ?? author?.name}</dd>
            <dt>수표 받는 방법</dt>
            <dd>
              {claim.check_delivery === "mail" ? `우편 · ${claim.payee_mail_address ?? ""}` : "주일에 재정부에서 수령"}
            </dd>
          </dl>
          <ul className="list">
            {(lines ?? []).map((l) => (
              <li key={l.id} className="row-link">
                <span>{l.description}</span>
                <span>{formatCents(Number(l.amount_cents))}</span>
              </li>
            ))}
          </ul>
          <div className="thumbs">
            {(attachments ?? []).map((a, i) => {
              const url = receiptUrl(a.id);
              return (
                <a key={a.id} href={url}>
                  {a.mime.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={`영수증 ${i + 1}`} />
                  ) : (
                    `PDF ${i + 1}`
                  )}
                </a>
              );
            })}
          </div>
          <p className="muted">사진을 누르면 크게 볼 수 있습니다. · Tap a receipt to enlarge.</p>
          {claim.dup_warning && <p className="notice">같은 영수증이 다른 청구서에 있을 수 있습니다.</p>}
          {claim.late && <p className="notice">사용일에서 60일이 지난 청구입니다.</p>}
        </section>
      )}

      {isMyTurn && (
        <ApproverPanel
          claimId={claim.id}
          version={claim.version}
          amount={formatCents(Number(claim.total_cents))}
          payee={claim.payee_name ?? author?.name ?? ""}
          receiptCount={(attachments ?? []).length}
          reasons={reasons}
        />
      )}

      {myDecision && !isAuthor && (
        <section className="card stack ok-card" role="status">
          <p className="subtitle">
            {myDecision.decision === "approve" ? "승인하셨습니다" : "보완을 요청하셨습니다"}{" "}
            <span className="en">{myDecision.decision === "approve" ? "You approved" : "You requested changes"}</span>
          </p>
          <p className="muted">
            {myDecision.decided_at ? formatChurchDateTime(myDecision.decided_at) : ""}
            {notifiedNext && unreachable.length === 0 ? ` · ${notifiedNext}께 메일로 알렸습니다.` : ""}
          </p>
          {unreachable.length > 0 && (
            <p className="notice">
              {unreachable.join(", ")}님께 메일을 보내지 못했습니다. 카톡이나 전화로 알려 주세요.
              {"\n"}Could not email {unreachable.join(", ")}. Please tell them by KakaoTalk or phone.
            </p>
          )}
          <Link className="btn btn-main" href="/">
            내가 볼 다른 청구서 <span className="en">Back to my list</span>
          </Link>
        </section>
      )}

      {canFinance && (
        <FinancePanel
          claimId={claim.id}
          version={claim.version}
          status={claim.status}
          dupWarning={claim.dup_warning}
          reasons={reasons}
        />
      )}

      {claim.claim_no && (
        <a className="btn btn-ghost" href={`/claims/${claim.id}/print`}>
          인쇄용 청구서 <span className="en">Print</span>
        </a>
      )}

      {isAuthor && !isDraft && (
        <AuthorActions
          claimId={claim.id}
          version={claim.version}
          status={claim.status}
          canWithdraw={claim.status === "in_review" && !currentRound.some((s) => s.decision)}
          waitingOn={claim.status === "in_review" ? (nameOf.get(currentStep?.approver_id ?? "") ?? null) : null}
        />
      )}

      {pastRounds.length > 0 && (
        <section className="card stack">
          <h2 className="subtitle">이전 기록</h2>
          <ul className="list">
            {pastRounds.map((s) => (
              <li key={s.id} className="row-link">
                <span>
                  {s.round}회차 · {nameOf.get(s.approver_id)}
                  {s.reason ? ` · ${s.reason}` : ""}
                </span>
                <span className="muted">{s.decision === "approve" ? "승인" : "보완 요청"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link className="btn btn-ghost" href="/">
        홈으로 <span className="en">Home</span>
      </Link>
    </div>
  );
}

export default function ClaimPage(props: Props) {
  return (
    <main className="page">
      <Suspense fallback={<p className="muted">불러오는 중…</p>}>
        <ClaimView {...props} />
      </Suspense>
    </main>
  );
}
