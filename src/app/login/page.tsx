import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { safeNextPath } from "@/lib/safe-next";

export const metadata = { title: "로그인 · 교회 지출청구" };

type Props = { searchParams: Promise<{ next?: string; error?: string }> };

async function LoginBody({ searchParams }: Props) {
  const sp = await searchParams;
  return <LoginForm next={safeNextPath(sp.next)} error={sp.error ?? null} />;
}

export default function LoginPage(props: Props) {
  return (
    <main className="page">
      <h1 className="title">
        로그인 <span className="en">Sign in</span>
      </h1>
      <Suspense fallback={<p className="muted">불러오는 중…</p>}>
        <LoginBody {...props} />
      </Suspense>
    </main>
  );
}
