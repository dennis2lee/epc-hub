"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { detectInApp, externalBrowserUrl } from "@/lib/inapp";
import { uploadTrialFile, type UploadResult } from "./actions";

export type SessionInfo =
  | { signedIn: false }
  | {
      signedIn: true;
      userId: string;
      provider: string;
      providers: string[];
      email: string | null;
      nickname: string | null;
      lastSignInAt: string | null;
    };

function noopSubscribe() {
  return () => {};
}

function ManualCheck({ question, onAnswer }: { question: string; onAnswer: (value: boolean) => void }) {
  return (
    <div className="stack">
      <span>{question}</span>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-ghost" onClick={() => onAnswer(true)}>
          됐어요
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onAnswer(false)}>
          안 돼요
        </button>
      </div>
    </div>
  );
}

type Check = { label: string; result: "ok" | "fail" | "skip"; note?: string };

export function TrialClient({ session }: { session: SessionInfo }) {
  // Browser-only values; the server snapshot is empty.
  const ua = useSyncExternalStore(noopSubscribe, () => navigator.userAgent, () => "");
  const href = useSyncExternalStore(noopSubscribe, () => window.location.href, () => "");
  const [uploads, setUploads] = useState<UploadResult[]>([]);
  const [shareResult, setShareResult] = useState<string | null>(null);
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [pending, startTransition] = useTransition();

  const inApp = ua ? detectInApp(ua) : null;
  const external = ua && href ? externalBrowserUrl(href, ua) : null;
  const nextParam = encodeURIComponent("/trial");

  function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await uploadTrialFile(fd);
      setUploads((u) => [...u, r]);
    });
  }

  async function onShare() {
    if (!navigator.share) {
      setShareResult("지원 안 함");
      return;
    }
    try {
      await navigator.share({ title: "교회 지출청구 시험", url: window.location.href });
      setShareResult("성공");
    } catch (err) {
      setShareResult(`실패: ${(err as Error).name}`);
    }
  }

  const checks: Check[] = useMemo(
    () => [
      { label: "브라우저", result: "ok", note: inApp ? `앱 안 브라우저 (${inApp})` : "일반 브라우저" },
      {
        label: "로그인",
        result: session.signedIn ? "ok" : "fail",
        note: session.signedIn ? `${session.provider} (${session.providers.join(",")})` : "로그인 안 됨",
      },
      {
        label: "업로드",
        result: uploads.some((u) => u.ok) ? "ok" : uploads.length ? "fail" : "skip",
        note: uploads.map((u) => (u.ok ? `${u.mime} ${u.bytes}B` : u.error)).join(" / "),
      },
      { label: "CSV 받기", result: manual.csv === undefined ? "skip" : manual.csv ? "ok" : "fail" },
      { label: "인쇄", result: manual.print === undefined ? "skip" : manual.print ? "ok" : "fail" },
      { label: "공유", result: shareResult === "성공" ? "ok" : shareResult ? "fail" : "skip", note: shareResult ?? "" },
      { label: "앱 다시 열어도 로그인 유지", result: manual.persist === undefined ? "skip" : manual.persist ? "ok" : "fail" },
    ],
    [inApp, session, uploads, manual, shareResult],
  );

  const summary = [
    `시험 시각: ${new Date().toISOString()}`,
    `UA: ${ua}`,
    ...checks.map((c) => `${c.label}: ${c.result}${c.note ? ` (${c.note})` : ""}`),
  ].join("\n");

  const answer = (id: string) => (value: boolean) => setManual((m) => ({ ...m, [id]: value }));

  return (
    <div className="stack">
      <section className="card stack">
        <h2 className="subtitle">1. 브라우저</h2>
        <dl className="kv">
          <dt>종류</dt>
          <dd>{inApp ? `앱 안 브라우저 (${inApp})` : "일반 브라우저"}</dd>
          <dt>UA</dt>
          <dd>{ua}</dd>
        </dl>
        {external && (
          <a className="btn btn-ghost" href={external}>
            외부 브라우저로 열기
          </a>
        )}
      </section>

      <section className="card stack">
        <h2 className="subtitle">2. 로그인</h2>
        {session.signedIn ? (
          <dl className="kv">
            <dt>상태</dt>
            <dd className="ok">로그인됨</dd>
            <dt>방식</dt>
            <dd>{session.provider}</dd>
            <dt>닉네임</dt>
            <dd>{session.nickname ?? "(없음)"}</dd>
            <dt>이메일</dt>
            <dd>{session.email ?? "(없음)"}</dd>
            <dt>사용자 ID</dt>
            <dd>{session.userId}</dd>
          </dl>
        ) : (
          <p className="bad">로그인 안 됨</p>
        )}
        <a className="btn btn-kakao" href={`/auth/kakao/start?next=${nextParam}`}>
          카카오 로그인 (방식 2)
        </a>
        <a className="btn btn-ghost" href={`/login?next=${nextParam}`}>
          로그인 화면 (방식 1, 이메일 코드)
        </a>
        {session.signedIn && (
          <form action="/auth/signout" method="post">
            <button className="btn btn-ghost" style={{ width: "100%" }}>
              로그아웃
            </button>
          </form>
        )}
      </section>

      <section className="card stack">
        <h2 className="subtitle">3. 영수증 사진 올리기</h2>
        <p className="muted">카메라로 찍기, 사진첩에서 고르기, PDF를 각각 해 보세요.</p>
        <form onSubmit={onUpload} className="stack">
          <input id="trial-file" name="file" type="file" accept="image/*,application/pdf" required />
          <button className="btn btn-main" disabled={pending || !session.signedIn}>
            {pending ? "올리는 중…" : "올리기"}
          </button>
        </form>
        <ul>
          {uploads.map((u, i) => (
            <li key={i} className={u.ok ? "ok" : "bad"}>
              {u.ok ? `${u.name} · ${u.mime} · ${u.bytes}B · sha256 ${u.sha256.slice(0, 12)}…` : u.error}
            </li>
          ))}
        </ul>
      </section>

      <section className="card stack">
        <h2 className="subtitle">4. 파일 받기 · 인쇄 · 공유</h2>
        <a className="btn btn-ghost" href="/trial/csv">
          CSV 파일 받기
        </a>
        <ManualCheck question="CSV 파일이 받아졌나요?" onAnswer={answer("csv")} />
        <a className="btn btn-ghost" href="/trial/print">
          인쇄 화면 열기
        </a>
        <ManualCheck question="인쇄 대화상자가 열렸나요?" onAnswer={answer("print")} />
        <button type="button" className="btn btn-ghost" onClick={onShare}>
          문자·카톡으로 공유하기 시험
        </button>
        {shareResult && <p>공유: {shareResult}</p>}
      </section>

      <section className="card stack">
        <h2 className="subtitle">5. 로그인 유지</h2>
        <p className="muted">카톡을 완전히 닫았다가 같은 링크를 다시 열어 보세요.</p>
        <ManualCheck question="다시 열었을 때도 로그인되어 있었나요?" onAnswer={answer("persist")} />
      </section>

      <section className="card stack">
        <h2 className="subtitle">결과 요약</h2>
        <pre className="summary">{summary}</pre>
        <button
          type="button"
          className="btn btn-main"
          onClick={() => navigator.clipboard?.writeText(summary).catch(() => undefined)}
        >
          결과 복사하기
        </button>
      </section>
    </div>
  );
}
