import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/server/env";
import { createServiceClient } from "@/lib/server/admin";
import { dispatchAllPending } from "@/lib/server/notify";

// Daily job (Vercel Cron, see vercel.json): retry pending emails and send the
// office a digest of stuck claims. Authenticated with CRON_SECRET.
function authorized(request: NextRequest): boolean {
  const sent = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${serverEnv.cronSecret}`;
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const PROBLEM: Record<string, string> = {
  waiting: "오래 기다리는 중",
  approver_not_active: "결재자 확인 전·정지",
  no_dept_head: "부장 미지정",
  no_elder: "담당 장로 미지정",
  no_independent_approver: "본인 외 결재자 없음",
  no_finance_handler: "처리할 재정 담당 없음",
};

export async function GET(request: NextRequest) {
  if (!authorized(request)) return new NextResponse("Unauthorized", { status: 401 });

  const retried = await dispatchAllPending();

  const db = createServiceClient();
  const [{ data: stuck }, { data: admins }] = await Promise.all([db.rpc("stuck_digest_srv"), db.rpc("admin_emails_srv")]);
  let digestSent = 0;
  if (stuck && stuck.length > 0 && admins && admins.length > 0) {
    const lines = stuck.map((s) => `- ${s.claim_no ?? "작성 중"} · ${s.department} · ${PROBLEM[s.problem] ?? s.problem} · ${s.days_waiting}일째`);
    const text = `막힌 청구서 ${stuck.length}건이 있습니다.\n\n${lines.join("\n")}\n\n${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/admin`;
    const { sendEmail } = await import("@/lib/server/notify");
    for (const a of admins) {
      if (!a.email) continue;
      try {
        await sendEmail(a.email, `[교회 지출청구] 막힌 청구서 ${stuck.length}건`, text);
        digestSent++;
      } catch (err) {
        console.error("[cron] digest failed", err);
      }
    }
  }
  return NextResponse.json({ retried, stuck: stuck?.length ?? 0, digestSent });
}
