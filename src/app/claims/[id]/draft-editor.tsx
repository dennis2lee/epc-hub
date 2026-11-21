"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveDraft } from "../actions";

type Line = { description: string; amount: string; budget_code: string };

type Props = {
  claimId: string;
  version: number;
  departments: { id: string; name: string }[];
  today: string;
  initial: {
    department: string;
    purpose: string;
    attendees: string;
    expenseDate: string;
    checkDelivery: "pickup" | "mail";
    lines: Line[];
  };
};

/** Step-by-step draft form: purpose and amount, then receipts, then check delivery. */
export function DraftEditor({ claimId, version, departments, initial, today }: Props) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [lines, setLines] = useState<Line[]>(initial.lines.length ? initial.lines : [{ description: "", amount: "", budget_code: "" }]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function updateLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    start(async () => {
      const r = await saveDraft({
        claimId,
        version,
        department: form.department,
        purpose: form.purpose,
        attendees: form.attendees,
        expenseDate: form.expenseDate,
        checkDelivery: form.checkDelivery,
        lines: lines.filter((l) => l.description.trim() || l.amount.trim()),
      });
      if (!r.ok) {
        setMessage(r.error);
        return;
      }
      setMessage("저장했습니다.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSave} className="card stack">
      <h2 className="subtitle">
        1. 사용 목적과 금액 <span className="en">Purpose and amount</span>
      </h2>
      <label className="field">
        <span>부서</span>
        <select id="draft-department" value={form.department} onChange={(e) => update("department", e.target.value)}>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>
          사용 목적 <span className="en">Purpose</span>
        </span>
        <input
          id="draft-purpose"
          value={form.purpose}
          onChange={(e) => update("purpose", e.target.value)}
          placeholder="예: 성탄 행사 간식"
          maxLength={300}
        />
        <span className="muted">구제·경조비는 받는 분의 실명을 쓰지 않습니다.</span>
      </label>
      <label className="field">
        <span>참석자 (식사인 경우)</span>
        <input id="draft-attendees" value={form.attendees} onChange={(e) => update("attendees", e.target.value)} maxLength={300} />
      </label>
      <label className="field">
        <span>
          사용일 <span className="en">Date</span>
        </span>
        <input id="draft-date" type="date" max={today} value={form.expenseDate} onChange={(e) => update("expenseDate", e.target.value)} />
      </label>

      <div className="stack">
        <span>
          항목 <span className="en">Items (세금·팁 포함 금액)</span>
        </span>
        {lines.map((l, i) => (
          <div key={i} className="line-row">
            <label className="field">
              <span className="muted">내용</span>
              <input id={`line-desc-${i}`} value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} maxLength={200} />
            </label>
            <label className="field">
              <span className="muted">금액 ($)</span>
              <input
                id={`line-amount-${i}`}
                inputMode="decimal"
                placeholder="0.00"
                value={l.amount}
                onChange={(e) => updateLine(i, { amount: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="btn btn-ghost"
              aria-label="항목 지우기"
              onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))}
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost" onClick={() => setLines((ls) => [...ls, { description: "", amount: "", budget_code: "" }])}>
          항목 더하기
        </button>
      </div>

      <fieldset className="stack" style={{ border: 0, padding: 0 }}>
        <legend className="subtitle">
          3. 수표 받는 방법 <span className="en">Check delivery</span>
        </legend>
        <label>
          <input type="radio" name="delivery" checked={form.checkDelivery === "pickup"} onChange={() => update("checkDelivery", "pickup")} /> 주일에
          재정부에서 받기
        </label>
        <label>
          <input type="radio" name="delivery" checked={form.checkDelivery === "mail"} onChange={() => update("checkDelivery", "mail")} /> 우편으로
          받기 (내 정보에 주소가 있어야 합니다)
        </label>
      </fieldset>

      {message && <p className="notice">{message}</p>}
      <button className="btn btn-main" disabled={pending}>
        {pending ? "저장 중…" : "저장하기"} <span className="en">Save</span>
      </button>
    </form>
  );
}
