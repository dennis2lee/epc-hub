// Human-friendly status text (design §7 "화면 용어").

const LABELS: Record<string, { ko: string; en: string }> = {
  draft: { ko: "작성 중", en: "Draft" },
  in_review: { ko: "결재 중", en: "In review" },
  rejected: { ko: "보완 요청 받음", en: "Changes requested" },
  approved: { ko: "재정부 확인 대기", en: "Awaiting finance" },
  received: { ko: "수표 준비됨", en: "Check ready" },
  paid: { ko: "수표 발행됨", en: "Check issued" },
  cancelled: { ko: "취소됨", en: "Cancelled" },
  deleted: { ko: "삭제됨", en: "Deleted" },
};

export function statusText(status: string): { ko: string; en: string } {
  return LABELS[status] ?? { ko: status, en: status };
}

export function StatusLabel({ status }: { status: string }) {
  const s = statusText(status);
  return (
    <span className="pill">
      {s.ko} <span className="en">{s.en}</span>
    </span>
  );
}
