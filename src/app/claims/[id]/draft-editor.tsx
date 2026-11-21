"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteDraft, saveAndSubmit, saveDraft, type DraftInput } from "../actions";
import { errorMessage } from "@/lib/i18n";
import { formatCents, parseDollarsToCents } from "@/lib/money";
import { ConfirmSheet } from "@/app/components/confirm-sheet";

type Line = { description: string; amount: string; budget_code: string };

type Props = {
  claimId: string;
  version: number;
  round: number;
  departments: { id: string; name: string; name_en: string | null }[];
  today: string;
  receiptCount: number;
  legalNameMissing: boolean;
  mailAddressMissing: boolean;
  preview: { seq: number; roles: string[]; approver_name: string }[];
  previewError: string | null;
  initial: {
    department: string;
    purpose: string;
    attendees: string;
    expenseDate: string;
    checkDelivery: "pickup" | "mail";
    lines: Line[];
  };
  /** The receipt section, rendered between the amounts and the submit button. */
  children: React.ReactNode;
};

const ROLE_LABEL: Record<string, string> = { dept_head: "부장", elder: "담당 장로" };

const PREVIEW_ERRORS: Record<string, string> = {
  no_dept_head: "이 부서에 부장이 지정되어 있지 않습니다. 사무실에 문의해 주세요.\nNo department head is assigned.",
  no_elder: "이 부서에 담당 장로가 지정되어 있지 않습니다. 사무실에 문의해 주세요.\nNo elder is assigned.",
  approver_not_active: "결재하실 분이 아직 가입하지 않았습니다. 사무실에 알려 주세요.\nAn approver is not set up yet.",
  no_independent_approver: "본인 외에 결재할 분이 없습니다. 사무실에 문의해 주세요.\nNo independent approver.",
};

const EMPTY_LINE: Line = { description: "", amount: "", budget_code: "" };

/**
 * The whole draft on one screen: purpose and amounts, receipts, check delivery,
 * then one "save and submit" button, so what is submitted is always what is on
 * screen (M2 review).
 */
export function DraftEditor(props: Props) {
  const { claimId, version, departments, initial, today } = props;
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [lines, setLines] = useState<Line[]>(initial.lines.length ? initial.lines : [EMPTY_LINE]);
  const [saved, setSaved] = useState(() => JSON.stringify({ form: initial, lines: initial.lines.length ? initial.lines : [EMPTY_LINE] }));
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const messageRef = useRef<HTMLParagraphElement>(null);

  const dirty = JSON.stringify({ form, lines }) !== saved;
  const total = useMemo(
    () => lines.reduce((sum, l) => sum + (parseDollarsToCents(l.amount) ?? 0), 0),
    [lines],
  );

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (message) messageRef.current?.focus();
  }, [message]);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function updateLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function input(): DraftInput {
    return {
      claimId,
      version,
      department: form.department,
      purpose: form.purpose,
      attendees: form.attendees,
      expenseDate: form.expenseDate,
      checkDelivery: form.checkDelivery,
      lines: lines.filter((l) => l.description.trim() || l.amount.trim()),
    };
  }

  async function save(): Promise<boolean> {
    const r = await saveDraft(input());
    if (!r.ok) {
      setMessage({ text: r.error, error: true });
      return false;
    }
    setSaved(JSON.stringify({ form, lines }));
    return true;
  }

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    start(async () => {
      if (await save()) {
        setMessage({ text: "저장했습니다.\nSaved.", error: false });
        router.refresh();
      }
    });
  }

  function onSubmitClaim() {
    setMessage(null);
    start(async () => {
      const r = await saveAndSubmit(input());
      if (!r.ok) {
        setMessage({ text: r.error, error: true });
        router.refresh();
        return;
      }
      setSaved(JSON.stringify({ form, lines }));
      if (r.message) setMessage({ text: r.message, error: false });
      router.refresh();
    });
  }

  /** Save first, then go to My info, so nothing typed is lost. */
  function goToProfile() {
    start(async () => {
      if (dirty && !(await save())) return;
      router.push(`/profile?next=${encodeURIComponent(`/claims/${claimId}`)}`);
    });
  }

  function onDelete() {
    start(async () => {
      setSaved(JSON.stringify({ form, lines })); // no unsaved-changes prompt on the redirect
      const r = await deleteDraft(claimId, version);
      if (r && !r.ok) setMessage({ text: r.error, error: true });
    });
  }

  const previewErr = props.previewError ? (PREVIEW_ERRORS[props.previewError] ?? errorMessage(props.previewError)) : null;
  const blockers: string[] = [];
  if (props.legalNameMissing) blockers.push("수표에 쓸 영문 이름 · Legal name in English");
  if (form.checkDelivery === "mail" && props.mailAddressMissing) blockers.push("우편 주소 · Mailing address");

  return (
    <>
      {blockers.length > 0 && (
        <section className="card stack notice-card" role="status">
          <p>
            올리기 전에 &lsquo;내 정보&rsquo;에 넣어 주세요: <strong>{blockers.join(", ")}</strong>
          </p>
          <button type="button" className="btn btn-main" onClick={goToProfile} disabled={pending}>
            지금 넣기 <span className="en">Add now</span>
          </button>
        </section>
      )}

      <form onSubmit={onSave} className="card stack" noValidate>
        <h2 className="subtitle">
          1. 사용 목적과 금액 <span className="en">Purpose and amount</span>
        </h2>
        <label className="field">
          <span>
            부서 <span className="en">Department</span>
          </span>
          <select id="draft-department" value={form.department} onChange={(e) => update("department", e.target.value)}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.name_en ? ` · ${d.name_en}` : ""}
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
          <span>
            참석자 (식사인 경우) <span className="en">Attendees, for meals</span>
          </span>
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
            항목과 금액 <span className="en">Items</span>
          </span>
          <span className="muted">세금·팁을 포함한 금액을 넣어 주세요. · Include tax and tip.</span>
          {lines.map((l, i) => (
            <div key={i} className="line-row">
              <label className="field">
                <span className="muted">
                  내용 <span className="en">Item</span>
                </span>
                <input id={`line-desc-${i}`} value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} maxLength={200} />
              </label>
              <label className="field">
                <span className="muted">
                  금액 <span className="en">Amount ($)</span>
                </span>
                <input
                  id={`line-amount-${i}`}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={l.amount}
                  maxLength={20}
                  onChange={(e) => updateLine(i, { amount: e.target.value })}
                />
              </label>
              {lines.length > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label={`${i + 1}번째 줄 지우기`}
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn btn-ghost" onClick={() => setLines((ls) => [...ls, EMPTY_LINE])}>
            항목 더하기 <span className="en">Add item</span>
          </button>
          <p className="total-line" aria-live="polite">
            합계 <span className="en">Total</span> <strong id="draft-total">{formatCents(total)}</strong>
          </p>
        </div>

        <button className="btn btn-ghost" disabled={pending || !dirty}>
          {pending ? "저장 중…" : dirty ? "임시 저장" : "저장됨"} <span className="en">{dirty ? "Save draft" : "Saved"}</span>
        </button>
      </form>

      {props.children}

      <section className="card stack">
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="subtitle">
            3. 수표 받는 방법 <span className="en">Check delivery</span>
          </legend>
          <label className="choice">
            <input type="radio" name="delivery" checked={form.checkDelivery === "pickup"} onChange={() => update("checkDelivery", "pickup")} />
            <span>
              주일에 재정부에서 받기 <span className="en">Pick up on Sunday</span>
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="delivery" checked={form.checkDelivery === "mail"} onChange={() => update("checkDelivery", "mail")} />
            <span>
              우편으로 받기 <span className="en">By mail</span>
            </span>
          </label>
        </fieldset>
      </section>

      <section className="card stack">
        <h2 className="subtitle">
          4. 결재 올리기 <span className="en">Submit for approval</span>
        </h2>
        {previewErr ? (
          <p className="notice" role="alert">
            {previewErr}
          </p>
        ) : (
          <p>
            결재 순서 <span className="en">Approval order</span>:{" "}
            {props.preview.map((p) => `${p.roles.map((r) => ROLE_LABEL[r] ?? r).join("·")} ${p.approver_name}`).join(" → ")} → 재정부
          </p>
        )}
        <p className="muted">
          지금 화면의 내용을 저장하고 첫 결재자에게 메일로 알립니다. · Saves this screen and notifies the first approver.
        </p>
        {props.receiptCount === 0 && (
          <p className="notice">
            영수증이 아직 없습니다. 위 2번에서 사진을 넣어 주세요.
            {"\n"}No receipt yet: add a photo in step 2.
          </p>
        )}
        {message && (
          <p ref={messageRef} tabIndex={-1} className={message.error ? "notice" : "ok"} role={message.error ? "alert" : "status"}>
            {message.text}
          </p>
        )}
        <button
          type="button"
          id="submit-claim"
          className="btn btn-main"
          disabled={pending || !!previewErr || blockers.length > 0 || props.receiptCount === 0}
          onClick={onSubmitClaim}
        >
          {pending ? "처리 중…" : "결재 올리기"} <span className="en">Submit</span>
        </button>
      </section>

      {props.round === 0 && (
        <button type="button" className="link-danger" onClick={() => setConfirmDelete(true)} disabled={pending}>
          이 청구서 지우기 <span className="en">Delete draft</span>
        </button>
      )}
      {confirmDelete && (
        <ConfirmSheet
          title="이 청구서를 지웁니다. 되돌릴 수 없습니다."
          titleEn="Delete this draft? This cannot be undone."
          confirmLabel="지우기"
          confirmLabelEn="Delete"
          danger
          pending={pending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={onDelete}
        />
      )}
    </>
  );
}
