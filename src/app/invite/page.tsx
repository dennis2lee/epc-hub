import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { readInviteToken } from "@/lib/server/invite-cookie";
import { AcceptForm } from "./accept-form";

export const metadata = { title: "초대 · 교회 지출청구", robots: { index: false } };

const REASON_TEXT: Record<string, string> = {
  not_found: "초대 링크가 올바르지 않습니다. 사무실에 새 링크를 요청해 주세요.\nThis invite link is not valid. Please ask the office for a new one.",
  used: "이미 사용된 초대 링크입니다.\nThis invite link was already used.",
  expired:
    "초대 링크의 기한(7일)이 지났습니다. 사무실에 새 링크를 요청해 주세요.\nThis invite link has expired (7 days). Please ask the office for a new one.",
};

async function InviteBody() {
  const token = await readInviteToken();
  const supabase = await createClient();
  if (!token) {
    return (
      <div className="card stack">
        <p className="notice">{REASON_TEXT.not_found}</p>
        <Link className="btn btn-ghost" href="/">
          홈으로 <span className="en">Home</span>
        </Link>
      </div>
    );
  }
  const { data: userData } = await supabase.auth.getUser();

  // Opening the link never consumes it (link-preview bots open it too).
  if (!userData.user) {
    return (
      <div className="card stack">
        <p>
          교회 지출청구에 초대받으셨습니다. 먼저 로그인해 주세요.
          <br />
          <span className="en">You are invited to the church expense claims. Please sign in first.</span>
        </p>
        <Link className="btn btn-main" href="/login?next=%2Finvite">
          로그인하고 계속하기 <span className="en">Sign in</span>
        </Link>
      </div>
    );
  }

  const { data, error } = await supabase.rpc("invite_preview", { p_token: token });
  const preview = (data ?? {}) as { valid?: boolean; reason?: string; name?: string };
  if (error || !preview.valid) {
    return (
      <div className="card stack">
        <p className="notice">{REASON_TEXT[preview.reason ?? "not_found"] ?? REASON_TEXT.not_found}</p>
        <Link className="btn btn-ghost" href="/">
          홈으로 <span className="en">Home</span>
        </Link>
      </div>
    );
  }

  return <AcceptForm name={preview.name ?? ""} />;
}

export default function InvitePage() {
  return (
    <main className="page">
      <h1 className="title">
        초대 <span className="en">Invitation</span>
      </h1>
      <Suspense fallback={<p className="muted">불러오는 중…</p>}>
        <InviteBody />
      </Suspense>
    </main>
  );
}
