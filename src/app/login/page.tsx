import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { safeNextPath } from "@/lib/safe-next";
import { errorMessage } from "@/lib/i18n";

export const metadata = { title: "로그인 · 교회 지출청구" };

type Props = { searchParams: Promise<{ next?: string; error?: string }> };

async function LoginBody({ searchParams }: Props) {
  const sp = await searchParams;
  // Only short codes are accepted; they map to fixed text (no reflected messages).
  const code = sp.error && /^[a-z_]{1,40}$/.test(sp.error) ? sp.error : null;
  return <LoginForm next={safeNextPath(sp.next)} error={code ? errorMessage(code) : null} />;
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
