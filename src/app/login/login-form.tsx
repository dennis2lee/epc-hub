"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { detectInApp, externalBrowserUrl } from "@/lib/inapp";

// Option 1 (Supabase's built-in Kakao provider) is only for the device trial.
const SHOW_KAKAO_OPTION1 = process.env.NEXT_PUBLIC_KAKAO_OPTION1 === "1";

const SEND_FAILED = "메일을 보내지 못했습니다. 잠시 후 다시 해 주세요.\nCould not send the code. Please try again shortly.";
const TOO_MANY = "코드를 너무 자주 요청했습니다. 1분 뒤에 다시 해 주세요.\nToo many requests. Please wait a minute.";

const noop = () => () => {};
function useUserAgent(): string {
  return useSyncExternalStore(noop, () => navigator.userAgent, () => "");
}

type Props = { next: string; error: string | null };

export function LoginForm({ next, error }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [message, setMessage] = useState<string | null>(error);
  const [busy, setBusy] = useState(false);
  const ua = useUserAgent();
  const inApp = ua ? detectInApp(ua) : null;

  // The in-app browser may reload while the user reads the email; keep progress.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("login-progress") ?? "null");
      if (saved?.email && saved?.stage === "code") {
        setEmail(saved.email); // eslint-disable-line react-hooks/set-state-in-effect
        setStage("code");
      }
    } catch {
      // storage unavailable: start over
    }
  }, []);

  function remember(next: { email: string; stage: "email" | "code" }) {
    try {
      sessionStorage.setItem("login-progress", JSON.stringify(next));
    } catch {
      // ignore
    }
  }

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
      setMessage(SEND_FAILED);
      setBusy(false);
    }
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (err) {
      setMessage(err.status === 429 ? TOO_MANY : SEND_FAILED);
      return;
    }
    setStage("code");
    remember({ email: email.trim(), stage: "code" });
    setMessage(`${email.trim()}(으)로 6자리 코드를 보냈습니다. 메일함을 확인해 주세요.\nWe sent a 6-digit code to ${email.trim()}.`);
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
      setMessage("코드가 맞지 않거나 시간이 지났습니다. 아래 '코드 다시 받기'를 눌러 주세요.\nWrong or expired code: tap Resend.");
      return;
    }
    remember({ email: "", stage: "email" });
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="stack">
      {message && (
        <p className="notice" role="alert">
          {message}
        </p>
      )}

      {inApp && (
        <section className="card stack notice-card">
          <p>
            카카오톡 안에서 열린 화면입니다. 로그인이 잘 안 되면 휴대폰 브라우저로 열어 주세요.
            <br />
            <span className="en">Opened inside an app. If sign-in fails, open this page in your phone&apos;s browser.</span>
          </p>
          {externalBrowserUrl(window.location.href, ua) && (
            <a className="btn btn-ghost" href={externalBrowserUrl(window.location.href, ua) ?? "#"}>
              브라우저로 열기 <span className="en">Open in browser</span>
            </a>
          )}
        </section>
      )}

      <section className="card stack">
        <h2 className="subtitle">카카오 <span className="en">Kakao</span></h2>
        {/* Option 2 is our own OIDC flow (scope without email); option 1 is Supabase's built-in provider. */}
        <a className="btn btn-kakao" href={`/auth/kakao/start?next=${encodeURIComponent(next)}`}>
          카카오로 로그인 <span className="en">Sign in with Kakao</span>
        </a>
        {SHOW_KAKAO_OPTION1 && (
          <button type="button" className="btn btn-ghost" onClick={kakaoBuiltIn} disabled={busy}>
            카카오 로그인 (방식 1 시험용)
          </button>
        )}
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
              <span>
                {email.trim()}(으)로 받은 6자리 코드 <span className="en">6-digit code</span>
              </span>
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
            <button type="button" className="btn btn-ghost" onClick={() => sendCode()} disabled={busy}>
              코드 다시 받기 <span className="en">Resend code</span>
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setStage("email")} disabled={busy}>
              다른 주소로 받기 <span className="en">Use another email</span>
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
