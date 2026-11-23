import Link from "next/link";
import { Suspense } from "react";
import { canDraft, getMe } from "@/lib/server/session";
import { AccountGate } from "@/app/components/account-gate";
import { errorMessage } from "@/lib/i18n";
import { createClaim } from "../actions";

export const metadata = { title: "새 지출청구서 · 교회 지출청구" };

type Props = { searchParams: Promise<{ error?: string }> };

async function NewClaim({ searchParams }: Props) {
  const { me, supabase } = await getMe();
  if (!canDraft(me)) return <AccountGate me={me} next="/claims/new" />;
  const sp = await searchParams;
  const { data: departments } = await supabase
    .from("departments")
    .select("id, name, name_en, is_finance")
    .eq("active", true)
    .order("name");
  const mine = new Set(me.departments.map((d) => d.id));
  const sorted = [...(departments ?? [])].sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)));

  return (
    <form action={createClaim} className="card stack">
      {sp.error && <p className="notice">{errorMessage(sp.error)}</p>}
      <label className="field">
        <span>
          어느 부서의 지출인가요? <span className="en">Department</span>
        </span>
        <select id="new-department" name="department" required defaultValue={sorted[0]?.id}>
          {sorted.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.name_en ? ` · ${d.name_en}` : ""}
            </option>
          ))}
        </select>
      </label>
      <button className="btn btn-main">
        시작하기 <span className="en">Start</span>
      </button>
      <Link href="/" className="btn btn-ghost">
        돌아가기
      </Link>
    </form>
  );
}

export default function NewClaimPage(props: Props) {
  return (
    <main className="page">
      <h1 className="title">
        새 지출청구서 <span className="en">New claim</span>
      </h1>
      <Suspense fallback={<p className="muted">불러오는 중…</p>}>
        <NewClaim {...props} />
      </Suspense>
    </main>
  );
}
