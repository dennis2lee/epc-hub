"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startRevision, withdrawClaim } from "../actions";
import { CancelClaim } from "./cancel-claim";

type Props = {
  claimId: string;
  version: number;
  status: string;
  canWithdraw: boolean;
  waitingOn: string | null;
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

  return (
    <section className="card stack">
      {props.waitingOn && (
        <p>
          지금 {props.waitingOn}님 차례입니다. <span className="en">Waiting on {props.waitingOn}</span>
        </p>
      )}
      {message && <p className="notice">{message}</p>}
      {props.status === "in_review" && (
        <button type="button" className="btn btn-ghost" onClick={shareLink}>
          카톡·문자로 다시 요청하기 <span className="en">Remind by message</span>
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
      {props.status === "rejected" && <CancelClaim claimId={props.claimId} version={props.version} />}
    </section>
  );
}
