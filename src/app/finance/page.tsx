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
  if (!me.is_finance && !me.is_auditor) {
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
  const [{ data: queue }, { data: payments }] = await Promise.all([
    me.is_finance ? supabase.rpc("finance_queue") : Promise.resolve({ data: [] }),
    me.is_finance ? supabase.rpc("finance_payments", { p_since: null as unknown as string }) : Promise.resolve({ data: [] }),
  ]);
  return (
    <FinanceBoard
      today={today}
      month={today.slice(0, 7)}
      canAct={me.is_finance}
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
