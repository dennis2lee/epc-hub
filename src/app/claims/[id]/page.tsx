import Link from "next/link";
import { Suspense } from "react";
import { getMe, isActive } from "@/lib/server/session";
import { AccountGate } from "@/app/components/account-gate";
import { StatusLabel } from "@/app/components/status-label";
import { formatCents } from "@/lib/money";
import { churchDate, formatChurchDateTime } from "@/lib/time";
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
  if (!isActive(me)) return <AccountGate me={me} next={`/claims/${id}`} />;

  const { data: claim } = await supabase.from("claims").select("*").eq("id", id).maybeSingle();
  if (!claim) {
    return (
      <div className="card stack">
        <p>이 청구서를 볼 수 없습니다. 본인 차례가 아니거나 없는 청구서입니다.</p>
        <Link className="btn btn-ghost" href="/">
          홈으로
        </Link>
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

  const paths = (attachments ?? []).map((a) => a.storage_path);
  const { data: signed } = paths.length
    ? await supabase.storage.from("receipts").createSignedUrls(paths, 300)
    : { data: [] };
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  const isAuthor = claim.author_id === me.person_id;
  const isDraft = claim.status === "draft";
  const currentRound = (steps ?? []).filter((s) => s.round === claim.round);
  const currentStep = currentRound.find((s) => s.seq === claim.current_seq);
  const isMyTurn = claim.status === "in_review" && currentStep?.approver_id === me.person_id && !currentStep?.decision;
  const pastRounds = (steps ?? []).filter((s) => s.round < claim.round && s.decision);
  const rejectStep = claim.status === "rejected" ? currentRound.find((s) => s.decision === "reject") : undefined;

  let preview: { seq: number; roles: string[]; approver_name: string }[] = [];
  let previewError: string | null = null;
  if (isAuthor && isDraft) {
    const { data, error } = await supabase.rpc("preview_approval_line", { p_department: claim.department_id });
    preview = data ?? [];
    previewError = error?.message ?? null;
  }
  let departments: { id: string; name: string }[] = [];
  if (isAuthor && isDraft) {
    const { data } = await supabase.from("departments").select("id, name").eq("active", true).order("name");
    departments = data ?? [];
  }
  const reasons = Array.isArray(settings?.value) ? (settings.value as string[]) : ["영수증 누락", "기타"];
  let canFinance = false;
  if (claim.status === "approved") {
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
            departments={departments}
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
          />
          <ReceiptUploader
            claimId={claim.id}
            attachments={(attachments ?? []).map((a) => ({
              id: a.id,
              mime: a.mime,
              merchant: a.merchant,
              url: urlOf.get(a.storage_path) ?? null,
            }))}
          />
        </>
      ) : (
        <section className="card stack">
          <dl className="kv">
            <dt>사용 목적</dt>
            <dd>{claim.purpose}</dd>
            {claim.attendees && (
              <>
                <dt>참석자</dt>
                <dd>{claim.attendees}</dd>
              </>
            )}
            <dt>사용일</dt>
            <dd>{claim.expense_date}</dd>
            <dt>수표 받는 방법</dt>
            <dd>{claim.check_delivery === "mail" ? "우편" : "주일에 재정부에서 수령"}</dd>
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
              const url = urlOf.get(a.storage_path);
              return (
                <a key={a.id} href={url ?? "#"} target="_blank" rel="noreferrer">
                  {a.mime.startsWith("image/") && url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={`영수증 ${i + 1}`} />
                  ) : (
                    `영수증 ${i + 1}`
                  )}
                </a>
              );
            })}
          </div>
          {claim.dup_warning && <p className="notice">같은 영수증이 다른 청구서에 있을 수 있습니다.</p>}
          {claim.late && <p className="notice">사용일에서 60일이 지난 청구입니다.</p>}
        </section>
      )}

      {isMyTurn && <ApproverPanel claimId={claim.id} version={claim.version} amount={formatCents(Number(claim.total_cents))} receiptCount={(attachments ?? []).length} reasons={reasons} />}

      {canFinance && (
        <FinancePanel claimId={claim.id} version={claim.version} dupWarning={claim.dup_warning} reasons={reasons} />
      )}

      {claim.claim_no && (
        <a className="btn btn-ghost" href={`/claims/${claim.id}/print`}>
          인쇄용 청구서 <span className="en">Print</span>
        </a>
      )}

      {isAuthor && (
        <AuthorActions
          claimId={claim.id}
          version={claim.version}
          status={claim.status}
          round={claim.round}
          canWithdraw={claim.status === "in_review" && !currentRound.some((s) => s.decision)}
          preview={preview}
          previewError={previewError}
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
        홈으로
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
