import Link from "next/link";
import { Suspense } from "react";
import { getMe } from "@/lib/server/session";
import { AccountGate } from "@/app/components/account-gate";
import { ProfileForm } from "./profile-form";
import { safeNextPath } from "@/lib/safe-next";

type Props = { searchParams: Promise<{ next?: string }> };

export const metadata = { title: "내 정보 · 교회 지출청구" };

async function Profile({ searchParams }: Props) {
  const { next } = await searchParams;
  const back = next ? safeNextPath(next, "") : "";
  const { me } = await getMe();
  if (!me.signed_in || !me.linked || (me.status !== "active" && me.status !== "pending")) {
    return <AccountGate me={me} next="/profile" />;
  }
  return (
    <>
      <ProfileForm
        initial={{
          email: me.email ?? "",
          mailAddress: me.mail_address ?? "",
          legalNameEn: me.legal_name_en ?? "",
          lang: me.lang,
        }}
        back={back || null}
      />
      <Link className="btn btn-ghost" href="/">
        홈으로 <span className="en">Home</span>
      </Link>
    </>
  );
}

export default function ProfilePage(props: Props) {
  return (
    <main className="page">
      <h1 className="title">
        내 정보 <span className="en">My info</span>
      </h1>
      <Suspense fallback={<p className="muted">불러오는 중…</p>}>
        <Profile {...props} />
      </Suspense>
    </main>
  );
}
