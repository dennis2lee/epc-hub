import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/server/env";
import { createServiceClient } from "@/lib/server/admin";
import { dispatchAllPending, sendEmail } from "@/lib/server/notify";
import { centsToPlain } from "@/lib/money";
import { churchDate } from "@/lib/time";

// Daily job (Vercel Cron, see vercel.json): retry pending emails, then send the
// office and finance a digest. Authenticated with CRON_SECRET. The digest goes
// out at most once per church-local day even if the cron fires twice.
export const maxDuration = 60;

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
  notify_failed: "알림 메일 실패 — 전화로 알려 주세요",
};

const OLD_CHECK_DAYS = 90;

async function sendAll(to: (string | null)[], subject: string, text: string): Promise<number> {
  let sent = 0;
  for (const email of new Set(to.filter((x): x is string => !!x))) {
    try {
      await sendEmail(email, subject, text);
      sent++;
    } catch (err) {
      console.error("[cron] digest failed", err);
    }
  }
  return sent;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return new NextResponse("Unauthorized", { status: 401 });

  // Retrying emails must never stop the digest.
  let retried = 0;
  try {
    retried = await dispatchAllPending();
  } catch (err) {
    console.error("[cron] retry failed", err);
  }

  const db = createServiceClient();
  const { data: firstToday, error: runErr } = await db.rpc("claim_digest_run_srv");
  if (runErr) {
    console.error("[cron] digest run check failed", runErr.message);
    return NextResponse.json({ retried, digest: "error" }, { status: 500 });
  }
  if (firstToday !== true) return NextResponse.json({ retried, digest: "already_sent_today" });

  const [stuckRes, adminsRes, financeRes, checksRes] = await Promise.all([
    db.rpc("stuck_digest_srv"),
    db.rpc("admin_emails_srv"),
    db.rpc("finance_emails_srv"),
    db.rpc("old_checks_srv", { p_days: OLD_CHECK_DAYS }),
  ]);
  const rpcError = stuckRes.error ?? adminsRes.error ?? financeRes.error ?? checksRes.error;
  if (rpcError) {
    // Never send a partial digest or a false "all clear"; let the next call retry.
    console.error("[cron] digest query failed", rpcError.message);
    await db.rpc("release_digest_run_srv");
    return NextResponse.json({ retried, digest: "error" }, { status: 500 });
  }
  const admins = adminsRes.data ?? [];
  const finance = financeRes.data ?? [];
  const site = serverEnv.appOrigin;
  let digestSent = 0;
  let digestTried = 0;

  const stuckRows = stuckRes.data ?? [];
  const financeRows = stuckRows.filter((s) => s.problem === "no_finance_handler");
  const checks = checksRes.data ?? [];

  if (stuckRows.length > 0) {
    const lines = stuckRows.map(
      (s) =>
        `- ${s.claim_no ?? "작성 중"} · ${s.department} · 작성 ${s.author} · ${s.waiting_on ? `${s.waiting_on} 차례 · ` : ""}` +
        `${PROBLEM[s.problem] ?? s.problem} · ${s.days_waiting}일째`,
    );
    digestTried++;
    digestSent += await sendAll(
      admins.map((a) => a.email),
      `[교회 지출청구] 막힌 청구서 ${stuckRows.length}건`,
      `막힌 청구서 ${stuckRows.length}건이 있습니다.\n\n${lines.join("\n")}\n\n${site}/admin`,
    );
  } else if (new Date(`${churchDate()}T12:00:00Z`).getUTCDay() === 1) {
    // Weekly "all clear" on Mondays, so a silent cron is noticed.
    digestTried++;
    digestSent += await sendAll(
      admins.map((a) => a.email),
      "[교회 지출청구] 이번 주 막힌 청구서 없음",
      `막힌 청구서가 없습니다. 매일 점검이 정상적으로 돌고 있습니다.\n\n${site}/admin`,
    );
  }

  if (checks.length > 0 || financeRows.length > 0) {
    const parts: string[] = [];
    if (checks.length > 0) {
      const list = checks.map((c) => `- #${c.check_no} · ${c.payee_name} · ${centsToPlain(Number(c.amount_cents))} USD · ${c.days}일`);
      parts.push(`은행 결제가 ${OLD_CHECK_DAYS}일 넘게 확인되지 않은 수표 ${checks.length}장:\n${list.join("\n")}`);
    }
    if (financeRows.length > 0) {
      parts.push(`처리할 재정 담당이 없는 청구서 ${financeRows.length}건:\n${financeRows.map((s) => `- ${s.claim_no}`).join("\n")}`);
    }
    digestTried++;
    digestSent += await sendAll(
      finance.map((f) => f.email),
      "[교회 지출청구] 재정부 확인 필요",
      `${parts.join("\n\n")}\n\n${site}/finance`,
    );
  }

  // Finish the day only if a mail went out (or there was nothing to send);
  // otherwise the next call after ten minutes tries again.
  if (digestTried === 0 || digestSent > 0) await db.rpc("finish_digest_run_srv");
  return NextResponse.json({ retried, stuck: stuckRows.length, oldChecks: checks.length, digestSent });
}
