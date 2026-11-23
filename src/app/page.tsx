import Link from "next/link";
import { Suspense } from "react";
import { canDraft, getMe } from "@/lib/server/session";
import { AccountGate, PendingNotice } from "@/app/components/account-gate";
import { StatusLabel } from "@/app/components/status-label";
import { formatCents } from "@/lib/money";
import { churchDate, daysBetween, formatChurchDateTime } from "@/lib/time";
import { CallOffice } from "@/app/components/account-gate";

async function Dashboard() {
  const { me, supabase } = await getMe();
  if (!canDraft(me)) return <AccountGate me={me} next="/" />;
  const active = me.status === "active";

  // Pending accounts only see their own drafts; reviewing starts once active.
  const [{ data: queue }, { data: mine }] = await Promise.all([
    active ? supabase.rpc("my_review_queue") : Promise.resolve({ data: null }),
    supabase
      .from("claims")
      .select("id, claim_no, status, total_cents, purpose, updated_at, current_seq, round")
      .eq("author_id", me.person_id)
      .neq("status", "deleted")
      .order("updated_at", { ascending: false })
      .limit(30),
  ]);

  const today = churchDate();
  const waited = (iso: string | null) => {
    if (!iso) return "";
    const d = daysBetween(churchDate(new Date(iso)), today);
    return d <= 0 ? "오늘 올라옴" : `${d}일째`;
  };

  return (
    <div className="stack">
      <p>
        {me.name}님, 안녕하세요.{" "}
        <Link href="/profile" className="muted">
          내 정보 <span className="en">My info</span>
        </Link>
      </p>

      {!active && <PendingNotice name={me.name} next="/" />}

      {queue && queue.length > 0 && (
        <section className="card stack queue-card">
          <h2 className="subtitle">
            내가 볼 청구서 {queue.length}건 <span className="en">To review</span>
          </h2>
          <ul className="list">
            {queue.map((q) => (
              <li key={q.claim_id}>
                <Link href={`/claims/${q.claim_id}`} className="row-link">
                  <span>
                    {q.purpose} · {q.author}
                    <br />
                    <span className="muted">
                      {q.department} · {q.claim_no} · {waited(q.submitted_at)}
                    </span>
                  </span>
                  <strong>{formatCents(Number(q.total_cents))}</strong>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}


      <Link className={`btn ${queue && queue.length > 0 ? "btn-ghost" : "btn-main"}`} href="/claims/new">
        새 지출청구서 쓰기 <span className="en">New claim</span>
      </Link>

      <section className="card stack">
        <h2 className="subtitle">
          내 청구서 <span className="en">My claims</span>
        </h2>
        {!mine || mine.length === 0 ? (
          <p className="muted">아직 올린 청구서가 없습니다. · No claims yet.</p>
        ) : (
          <ul className="list">
            {mine.map((c) => (
              <li key={c.id}>
                <Link href={`/claims/${c.id}`} className="row-link">
                  <span>
                    {c.purpose || "(목적 미입력)"}
                    <br />
                    <span className="muted">
                      {c.claim_no ?? "작성 중"} · {formatChurchDateTime(c.updated_at)}
                    </span>
                  </span>
                  <span style={{ textAlign: "right" }}>
                    <strong>{formatCents(Number(c.total_cents))}</strong>
                    <br />
                    <StatusLabel status={c.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <nav className="stack">
        {(me.is_finance || me.is_auditor) && (
          <Link className="btn btn-ghost" href="/finance">
            재정부 화면 <span className="en">Finance</span>
          </Link>
        )}
        {me.is_admin && (
          <Link className="btn btn-ghost" href="/admin">
            관리자 화면 <span className="en">Admin</span>
          </Link>
        )}
        <CallOffice />
        <form action="/auth/signout" method="post">
          <button className="btn btn-ghost" style={{ width: "100%" }}>
            로그아웃 <span className="en">Sign out</span>
          </button>
        </form>
      </nav>
    </div>
  );
}

export default function Home() {
  return (
    <main className="page">
      <h1 className="title">
        교회 지출청구 <span className="en">Church Expense Claims</span>
      </h1>
      <Suspense fallback={<p className="muted">불러오는 중…</p>}>
        <Dashboard />
      </Suspense>
    </main>
  );
}
