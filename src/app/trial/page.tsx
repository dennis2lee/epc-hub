import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { TrialClient, type SessionInfo } from "./trial-client";

export const metadata = { title: "카카오 로그인 시험판 · 교회 지출청구" };

async function TrialWithSession() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const session: SessionInfo = user
    ? {
        signedIn: true,
        userId: user.id,
        provider: String(user.app_metadata?.provider ?? "unknown"),
        providers: (user.app_metadata?.providers as string[] | undefined) ?? [],
        email: user.email ?? null,
        nickname:
          (user.user_metadata?.name as string | undefined) ??
          (user.user_metadata?.nickname as string | undefined) ??
          (user.user_metadata?.full_name as string | undefined) ??
          null,
        lastSignInAt: user.last_sign_in_at ?? null,
      }
    : { signedIn: false };
  return <TrialClient session={session} />;
}

export default function TrialPage() {
  return (
    <main className="page">
      <h1 className="title">카카오 로그인 시험판</h1>
      <p className="muted">
        카톡으로 받은 링크를 눌러 이 화면을 열고, 위에서부터 차례로 시험합니다. 마지막의 결과 요약을 복사해 개발 담당에게 보내 주세요.
      </p>
      <Suspense fallback={<p className="muted">불러오는 중…</p>}>
        <TrialWithSession />
      </Suspense>
    </main>
  );
}
