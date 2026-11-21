"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteDraft, startRevision, submitClaim, withdrawClaim } from "../actions";
import { errorMessage } from "@/lib/i18n";

type Props = {
  claimId: string;
  version: number;
  status: string;
  round: number;
  canWithdraw: boolean;
  preview: { seq: number; roles: string[]; approver_name: string }[];
  previewError: string | null;
  waitingOn: string | null;
};

const ROLE_LABEL: Record<string, string> = { dept_head: "부장", elder: "담당 장로" };

const PREVIEW_ERRORS: Record<string, string> = {
  no_dept_head: "이 부서에 부장이 지정되어 있지 않습니다. 사무실에 문의해 주세요.",
  no_elder: "이 부서에 담당 장로가 지정되어 있지 않습니다. 사무실에 문의해 주세요.",
  approver_not_active: "결재하실 분이 아직 가입하지 않았습니다. 사무실에 알려 주세요.",
  no_independent_approver: "본인 외에 결재할 분이 없습니다. 사무실에 문의해 주세요.",
};

export function AuthorActions(props: Props) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setMessage(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setMessage(r.error ?? "처리하지 못했습니다.");
      else if (r.message) setMessage(r.message);
      router.refresh();
    });
  }

  async function shareLink() {
    const url = window.location.href;
    const text = "지출청구서를 올렸습니다. 살펴봐 주시면 감사하겠습니다.";
    if (navigator.share) {
      await navigator.share({ title: "교회 지출청구", text, url }).catch(() => undefined);
    } else {
      await navigator.clipboard?.writeText(`${text}\n${url}`).catch(() => undefined);
      setMessage("링크를 복사했습니다. 카톡이나 문자에 붙여 넣어 보내 주세요.");
    }
  }

  if (props.status === "draft") {
    const previewErr = props.previewError ? (PREVIEW_ERRORS[props.previewError] ?? errorMessage(props.previewError)) : null;
    return (
      <section className="card stack">
        <h2 className="subtitle">
          올리기 <span className="en">Submit</span>
        </h2>
        {previewErr ? (
          <p className="notice">{previewErr}</p>
        ) : (
          <p>
            결재 순서:{" "}
            {props.preview.map((p) => `${p.roles.map((r) => ROLE_LABEL[r] ?? r).join("·")} ${p.approver_name}`).join(" → ")} → 재정부
          </p>
        )}
        <p className="muted">저장한 뒤에 올려 주세요. 올리면 첫 결재자에게 메일이 갑니다.</p>
        {message && <p className="notice">{message}</p>}
        <button
          type="button"
          className="btn btn-main"
          disabled={pending || !!previewErr}
          onClick={() => run(() => submitClaim(props.claimId, props.version))}
        >
          {pending ? "올리는 중…" : "올리기"} <span className="en">Submit</span>
        </button>
        {props.round === 0 && (
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => run(() => deleteDraft(props.claimId, props.version))}>
            이 청구서 지우기
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="card stack">
      {props.waitingOn && <p>지금 {props.waitingOn}님 차례입니다.</p>}
      {message && <p className="notice">{message}</p>}
      {props.status === "in_review" && (
        <button type="button" className="btn btn-ghost" onClick={shareLink}>
          카톡·문자로 다시 요청하기
        </button>
      )}
      {props.canWithdraw && (
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => run(() => withdrawClaim(props.claimId, props.version))}>
          도로 가져오기 <span className="en">Withdraw</span>
        </button>
      )}
      {props.status === "rejected" && (
        <button type="button" className="btn btn-main" disabled={pending} onClick={() => run(() => startRevision(props.claimId, props.version))}>
          고쳐서 다시 올리기 <span className="en">Revise</span>
        </button>
      )}
    </section>
  );
}
