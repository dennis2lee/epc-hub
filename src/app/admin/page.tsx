import Link from "next/link";
import { Suspense } from "react";
import { getMe, isActive } from "@/lib/server/session";
import { AccountGate } from "@/app/components/account-gate";
import { churchDate } from "@/lib/time";
import { AdminPanels } from "./admin-panels";

export const metadata = { title: "관리자 · 교회 지출청구" };

async function Admin() {
  const { me, supabase } = await getMe();
  if (!isActive(me)) return <AccountGate me={me} next="/admin" />;
  if (!me.is_admin) {
    return (
      <div className="card stack">
        <p>관리자만 볼 수 있는 화면입니다.</p>
        <Link className="btn btn-ghost" href="/">
          홈으로
        </Link>
      </div>
    );
  }

  const [{ data: stuck }, { data: people }, { data: departments }, { data: positions }] = await Promise.all([
    supabase.rpc("stuck_claims"),
    supabase.rpc("admin_people"),
    supabase.from("departments").select("id, name, parent_id, is_finance, active").order("name"),
    supabase.from("positions").select("id, person_id, department_id, role, starts_on, ends_on").order("starts_on"),
  ]);

  return (
    <AdminPanels
      meId={me.person_id}
      today={churchDate()}
      stuck={stuck ?? []}
      people={people ?? []}
      departments={departments ?? []}
      positions={positions ?? []}
    />
  );
}

export default function AdminPage() {
  return (
    <main className="page">
      <h1 className="title">
        관리자 <span className="en">Admin</span>
      </h1>
      <Suspense fallback={<p className="muted">불러오는 중…</p>}>
        <Admin />
      </Suspense>
      <Link className="btn btn-ghost" href="/">
        홈으로
      </Link>
    </main>
  );
}
