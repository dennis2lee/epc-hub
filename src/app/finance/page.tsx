import Link from "next/link";
import { Suspense } from "react";
import { getMe, isActive } from "@/lib/server/session";
import { AccountGate } from "@/app/components/account-gate";
import { churchDate } from "@/lib/time";
import { FinanceBoard } from "./finance-board";

export const metadata = { title: "재정부 · 교회 지출청구" };

async function Finance() {
  const { me, supabase } = await getMe();
  if (!isActive(me)) return <AccountGate me={me} next="/finance" />;
  const { data: fin } = await supabase.rpc("me_finance");
  const f = (fin ?? {}) as { is_finance_member?: boolean; is_auditor?: boolean; holds_finance_role?: boolean };
  if (!f.is_finance_member && !f.is_auditor && !f.holds_finance_role) {
    return (
      <div className="card stack">
        <p>재정부만 볼 수 있는 화면입니다.</p>
        <Link className="btn btn-ghost" href="/">
          홈으로
        </Link>
      </div>
    );
  }
  const today = churchDate();
  // Same predicates as the database (decision D13): a finance role is usable
  // only after the office's in-person check; auditors read only.
  const canAct = !!f.is_finance_member;
  const canRead = canAct || !!f.is_auditor;
  const [{ data: queue }, { data: payments }] = await Promise.all([
    canAct ? supabase.rpc("finance_queue") : Promise.resolve({ data: [] }),
    canRead ? supabase.rpc("finance_payments", { p_since: null as unknown as string }) : Promise.resolve({ data: [] }),
  ]);
  const readOnlyReason = canAct
    ? null
    : f.is_auditor
      ? "감사위원 화면입니다. 보기만 할 수 있습니다. · Auditor view (read only)."
      : "재정 직책이 있지만 아직 사무실의 대면 확인 전입니다. 확인 후에 쓸 수 있습니다.";
  return (
    <FinanceBoard
      today={today}
      month={today.slice(0, 7)}
      canAct={canAct}
      readOnlyReason={readOnlyReason}
      queue={queue ?? []}
      payments={payments ?? []}
    />
  );
}

export default function FinancePage() {
  return (
    <main className="page">
      <h1 className="title">
        재정부 <span className="en">Finance</span>
      </h1>
      <Suspense fallback={<p className="muted">불러오는 중…</p>}>
        <Finance />
      </Suspense>
      <Link className="btn btn-ghost" href="/">
        홈으로
      </Link>
    </main>
  );
}
