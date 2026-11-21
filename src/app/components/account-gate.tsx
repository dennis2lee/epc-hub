import Link from "next/link";
import type { Me } from "@/lib/server/session";

const OFFICE_PHONE = process.env.NEXT_PUBLIC_OFFICE_PHONE ?? "";

/** Screens for everyone who is not an active member yet, each with a next action. */
export function AccountGate({ me, next }: { me: Me; next: string }) {
  if (!me.signed_in) {
    return (
      <div className="card stack">
        <p>로그인이 필요합니다.</p>
        <Link className="btn btn-main" href={`/login?next=${encodeURIComponent(next)}`}>
          로그인 <span className="en">Sign in</span>
        </Link>
      </div>
    );
  }
  if (!me.linked) {
    return (
      <div className="card stack">
        <p>등록되지 않은 계정입니다. 사무실에서 받은 초대 링크를 본인 휴대폰에서 열어 주세요.</p>
        {OFFICE_PHONE && <p className="muted">사무실 전화: {OFFICE_PHONE}</p>}
        <form action="/auth/signout" method="post">
          <button className="btn btn-ghost" style={{ width: "100%" }}>
            다른 계정으로 로그인
          </button>
        </form>
      </div>
    );
  }
  if (me.status === "pending") {
    return (
      <div className="card stack">
        <p className="subtitle">
          사무실 확인 중 <span className="en">Pending</span>
        </p>
        <p>{me.name}님, 사무실에서 확인하면 바로 쓸 수 있습니다. 보통 1~2일 안에 됩니다.</p>
        {OFFICE_PHONE && <p className="muted">급하시면 사무실로 전화해 주세요: {OFFICE_PHONE}</p>}
      </div>
    );
  }
  return (
    <div className="card stack">
      <p>이 계정은 지금 사용할 수 없습니다. 사무실에 문의해 주세요.</p>
      {OFFICE_PHONE && <p className="muted">사무실 전화: {OFFICE_PHONE}</p>}
    </div>
  );
}
