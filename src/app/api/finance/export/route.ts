import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { centsToPlain } from "@/lib/money";
import { errorCode } from "@/lib/i18n";
import { csvCell } from "@/lib/csv";
import { formatChurchDateTime } from "@/lib/time";

// CSV files for the church's accounting program (decision D19). Runs with the
// user's session; the SQL functions allow finance members and auditors only.
//   ?month=YYYY-MM       payments: every check issued that month (void ones at 0)
//   ?kind=outstanding    today's unpaid claims and uncleared checks

function respond(name: string, header: string[], rows: unknown[][], footer: unknown[][]): NextResponse {
  const lines = [header, ...rows, [], ...footer].map((r) => r.map(csvCell).join(","));
  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function failure(message: string | undefined): NextResponse {
  const code = errorCode(message);
  if (code === "not_finance") return new NextResponse("Forbidden", { status: 403 });
  if (code === "bad_month") return new NextResponse("month=YYYY-MM", { status: 400 });
  console.error("[export] failed", message);
  return new NextResponse("Export failed", { status: 500 });
}

const yn = (b: boolean | null) => (b ? "Y" : "");

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const generated = `생성 Generated: ${formatChurchDateTime(new Date())}`;

  if (request.nextUrl.searchParams.get("kind") === "outstanding") {
    const { data, error } = await supabase.rpc("finance_outstanding");
    if (error) return failure(error.message);
    const rows = (data ?? []).map((r) => [
      r.section === "unpaid" ? "미지급 Unpaid claim" : "미결제 Uncleared check",
      r.claim_no,
      r.check_no,
      r.payee_name,
      centsToPlain(Number(r.amount_cents)),
      r.since,
      r.days,
    ]);
    const total = (data ?? []).reduce((s, r) => s + Number(r.amount_cents), 0);
    return respond(
      "outstanding.csv",
      ["구분 Section", "문서번호 Claim", "수표 번호 Check", "수취인 Payee", "금액 Amount", "기준일 Since", "경과일 Days"],
      rows,
      [[generated], ["건수 Count", rows.length], ["합계 Total", centsToPlain(total)]],
    );
  }

  const month = request.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new NextResponse("month=YYYY-MM", { status: 400 });
  const { data, error } = await supabase.rpc("finance_export", { p_month: month });
  if (error) return failure(error.message);

  const header = [
    "수표 번호 Check",
    "발행일 Issued",
    "수표 상태 Check status",
    "수표 금액 Check amount",
    "문서번호 Claim",
    "부서 Department",
    "작성자 Submitted by",
    "수취인 Payee",
    "사용 목적 Purpose",
    "사용일 Date",
    "청구 금액 Amount",
    "결제일 Cleared",
    "무효일 Voided",
    "무효 사유 Void reason",
    "재발행 대상 Replaces",
    "결재 Approvals",
    "서류 확인 Verified by",
    "수표 기록 Recorded by",
    "결제 기록 Cleared by",
    "발행자 본인 결제 기록 Self-cleared",
    "결재자 1인 Single approver",
    "관리자 1인 기간 Solo admin",
    "60일 경과 Late",
    "중복 의심 Duplicate",
    "중복 확인 메모 Duplicate note",
    "보완·반송 횟수 Returns",
    "소급 기록 Backdated",
  ];
  const rows = (data ?? []).map((r) => [
    r.check_no,
    r.issued_on,
    r.payment_status,
    centsToPlain(Number(r.check_amount_cents)),
    r.claim_no,
    r.department,
    r.author,
    r.payee_name,
    r.purpose,
    r.expense_date,
    centsToPlain(Number(r.amount_cents)),
    r.cleared_on,
    r.voided_on,
    r.void_reason,
    r.replaces_check_no,
    r.approvers,
    r.received_by,
    r.paid_by,
    r.cleared_by,
    yn(r.self_cleared),
    yn(r.single_approver),
    yn(r.solo_admin_period),
    yn(r.late),
    yn(r.dup_warning),
    r.dup_note,
    r.returns_count,
    yn(r.backdated),
  ]);
  const total = (data ?? []).reduce((s, r) => s + Number(r.amount_cents), 0);
  const checks = new Set((data ?? []).filter((r) => r.payment_status !== "void").map((r) => r.check_no)).size;
  return respond(`payments-${month}.csv`, header, rows, [
    [generated],
    ["수표 수 Checks (live)", checks],
    ["청구 줄 수 Rows", rows.length],
    ["합계 Total (void = 0)", centsToPlain(total)],
  ]);
}
