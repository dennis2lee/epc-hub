// Server-generated CSV download. Blob downloads do not work inside the Android
// KakaoTalk webview, so files must come from a real HTTP response.
export function GET() {
  const rows = [
    ["문서번호", "부서", "금액", "상태"],
    ["2027-0001", "유년부", "128.40", "시험"],
    ["2027-0002", "EM 청년부", "1280.00", "시험"],
  ];
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\r\n");
  // A UTF-8 BOM makes Excel open Korean text correctly.
  return new Response(`﻿${csv}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="trial.csv"',
      "Cache-Control": "no-store",
    },
  });
}
