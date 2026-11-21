import Link from "next/link";

// Home page. In M2 this becomes the personal dashboard (my claims, my queue).
export default function Home() {
  return (
    <main className="page">
      <h1 className="title">
        교회 지출청구 <span className="en">Church Expense Claims</span>
      </h1>
      <p className="muted">지출청구서를 휴대폰으로 올리고 결재합니다. 지금은 시험판 단계입니다.</p>
      <div className="stack">
        <Link className="btn btn-main" href="/login">
          로그인 <span className="en">Sign in</span>
        </Link>
        <Link className="btn btn-ghost" href="/trial">
          카카오 로그인 시험판
        </Link>
      </div>
    </main>
  );
}
