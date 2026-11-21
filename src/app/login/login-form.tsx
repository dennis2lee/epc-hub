"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

type Props = { next: string; error: string | null };

export function LoginForm({ next, error }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [message, setMessage] = useState<string | null>(error);
  const [busy, setBusy] = useState(false);

  // Kakao option 1: Supabase's built-in Kakao provider.
  async function kakaoBuiltIn() {
    setBusy(true);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "kakao",
      options: { redirectTo, scopes: "profile_nickname profile_image" },
    });
    if (err) {
      setMessage(err.message);
      setBusy(false);
    }
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (err) {
      setMessage(err.message);
      return;
    }
    setStage("code");
    setMessage("메일로 6자리 코드를 보냈습니다. 메일함을 확인해 주세요.");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = createClient();
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "email",
    });
    setBusy(false);
    if (err) {
      setMessage("코드가 맞지 않거나 시간이 지났습니다. 다시 받아 주세요.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="stack">
      {message && <p className="notice">{message}</p>}

      <section className="card stack">
        <h2 className="subtitle">카카오 <span className="en">Kakao</span></h2>
        {/* Option 2 is our own OIDC flow (scope without email); option 1 is Supabase's built-in provider. */}
        <a className="btn btn-kakao" href={`/auth/kakao/start?next=${encodeURIComponent(next)}`}>
          카카오로 로그인 <span className="en">Sign in with Kakao</span>
        </a>
        <button type="button" className="btn btn-ghost" onClick={kakaoBuiltIn} disabled={busy}>
          카카오 로그인 (방식 1 시험용)
        </button>
      </section>

      <section className="card stack">
        <h2 className="subtitle">이메일 코드 <span className="en">Email code</span></h2>
        {stage === "email" ? (
          <form onSubmit={sendCode} className="stack">
            <label className="field">
              <span>이메일 주소 <span className="en">Email</span></span>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button className="btn btn-main" disabled={busy}>
              코드 받기 <span className="en">Send code</span>
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="stack">
            <label className="field">
              <span>메일로 받은 6자리 코드</span>
              <input
                id="login-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button className="btn btn-main" disabled={busy}>
              확인 <span className="en">Verify</span>
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setStage("email")}>
              다른 주소로 받기
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
