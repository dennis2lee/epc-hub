import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { centsToPlain } from "@/lib/money";

// Monthly CSV for the church's accounting program. Runs with the user's session;
// the SQL function allows finance members and auditors only.
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  // Neutralize spreadsheet formulas (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return new NextResponse("month=YYYY-MM", { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_export", { p_month: month });
  if (error) return new NextResponse("Forbidden", { status: 403 });

  const header = [
    "문서번호 Claim",
    "부서 Department",
    "작성자 Submitted by",
    "수취인 Payee",
    "사용 목적 Purpose",
    "사용일 Date",
    "금액 Amount",
    "수표 번호 Check",
    "발행일 Issued",
    "결제일 Cleared",
    "상태 Status",
    "결재자 1인 Single approver",
    "관리자 1인 기간 Solo admin",
    "60일 경과 Late",
  ];
  const rows = (data ?? []).map((r) =>
    [
      r.claim_no,
      r.department,
      r.author,
      r.payee_name,
      r.purpose,
      r.expense_date,
      centsToPlain(Number(r.amount_cents)),
      r.check_no,
      r.issued_on,
      r.cleared_on,
      r.status,
      r.single_approver ? "Y" : "",
      r.solo_admin_period ? "Y" : "",
      r.late ? "Y" : "",
    ]
      .map(csvCell)
      .join(","),
  );
  const body = `﻿${[header.map(csvCell).join(","), ...rows].join("\r\n")}\r\n`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="claims-${month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
