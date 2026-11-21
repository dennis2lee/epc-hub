import Link from "next/link";
import type { Me } from "@/lib/server/session";

const OFFICE_PHONE = process.env.NEXT_PUBLIC_OFFICE_PHONE ?? "";

/** A large "call the office" button; hidden when no number is configured. */
export function CallOffice({ main = false }: { main?: boolean }) {
  if (!OFFICE_PHONE) return null;
  return (
    <a className={`btn ${main ? "btn-main" : "btn-ghost"}`} href={`tel:${OFFICE_PHONE.replace(/[^\d+]/g, "")}`}>
      사무실에 전화 <span className="en">Call the office · {OFFICE_PHONE}</span>
    </a>
  );
}

/** Screens for everyone who is not an active member yet, each with a next action. */
export function AccountGate({ me, next }: { me: Me; next: string }) {
  if (!me.signed_in) {
    return (
      <div className="card stack">
        <p>
          로그인이 필요합니다. <span className="en">Please sign in.</span>
        </p>
        <Link className="btn btn-main" href={`/login?next=${encodeURIComponent(next)}`}>
          로그인 <span className="en">Sign in</span>
        </Link>
      </div>
    );
  }
  if (!me.linked) {
    return (
      <div className="card stack">
        <p>
          등록되지 않은 계정입니다. 사무실에서 받은 초대 링크를 본인 휴대폰에서 열어 주세요.
          <br />
          <span className="en">This account is not registered. Open the invitation link from the church office.</span>
        </p>
        <CallOffice main />
        <form action="/auth/signout" method="post">
          <button className="btn btn-ghost" style={{ width: "100%" }}>
            다른 계정으로 로그인 <span className="en">Use another account</span>
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
        <p>
          {me.name}님, 사무실에서 확인하면 바로 쓸 수 있습니다. 보통 1~2일 안에 됩니다.
          <br />
          <span className="en">The office will confirm your account, usually within 1–2 days.</span>
        </p>
        <Link className="btn btn-ghost" href={next}>
          새로 보기 <span className="en">Reload</span>
        </Link>
        <Link className="btn btn-ghost" href="/profile">
          내 정보 미리 넣기 <span className="en">Fill in my info</span>
        </Link>
        <CallOffice />
      </div>
    );
  }
  return (
    <div className="card stack">
      <p>
        이 계정은 지금 사용할 수 없습니다. 사무실에 문의해 주세요.
        <br />
        <span className="en">This account is currently suspended. Please call the office.</span>
      </p>
      <CallOffice main />
    </div>
  );
}
