"use client";

import { useEffect, useState, useTransition } from "react";
import { ConfirmSheet } from "@/app/components/confirm-sheet";
import { formatChurchDateTime } from "@/lib/time";
import { useRouter } from "next/navigation";
import {
  assignPosition,
  confirmInPerson,
  createDepartment,
  createInvite,
  createPerson,
  reactivatePerson,
  reassignStep,
  suspendPerson,
  type AdminResult,
} from "./actions";

type Stuck = {
  claim_id: string;
  claim_no: string | null;
  department: string;
  status: string;
  waiting_on: string | null;
  problem: string;
  days_waiting: number;
  version: number;
};
type Person = {
  id: string;
  name: string;
  phone_last4: string | null;
  has_email: boolean;
  status: string;
  needs_in_person_check: boolean;
  in_person_checked_at: string | null;
  logins: number;
};
type Department = { id: string; name: string; parent_id: string | null; is_finance: boolean; active: boolean };
type Position = { id: string; person_id: string; department_id: string; role: string; starts_on: string; ends_on: string | null };

const PROBLEM: Record<string, string> = {
  waiting: "오래 기다리는 중",
  approver_not_active: "결재자가 확인 전이거나 정지됨",
  no_dept_head: "부장 미지정",
  no_elder: "담당 장로 미지정",
  no_independent_approver: "본인 외 결재자 없음",
  no_finance_handler: "처리할 재정 담당 없음",
  notify_failed: "알림 메일을 보내지 못함(주소 없음·실패) — 전화로 알려 주세요",
};
const STATUS: Record<string, string> = { invited: "초대 전", pending: "사무실 확인 중", active: "사용 중", suspended: "정지" };
const ROLE: Record<string, string> = { dept_head: "부장", elder: "담당 장로", finance: "재정부원", finance_elder: "재정 담당 장로" };

type Props = {
  meId: string;
  today: string;
  stuck: Stuck[];
  people: Person[];
  departments: Department[];
  positions: Position[];
};

export function AdminPanels({ meId, today, stuck, people, departments, positions }: Props) {
  const router = useRouter();
  // Messages are shown inside the section that caused them, not at the top of a long page.
  const [messages, setMessages] = useState<Record<string, { text: string; ok: boolean }>>({});
  const [inviteLink, setInviteLink] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<Person | null>(null);
  const [reassign, setReassign] = useState<{ claimId: string; reason: string } | null>(null);
  const [pending, start] = useTransition();

  // Do not keep an invite token in a hidden (preserved) page after leaving.
  useEffect(() => () => setInviteLink(null), []);

  function run(section: string, fn: () => Promise<AdminResult>, done?: (r: AdminResult) => void, okText = "처리했습니다.") {
    setMessages((m) => ({ ...m, [section]: undefined as never }));
    start(async () => {
      const r = await fn();
      if (!r.ok) setMessages((m) => ({ ...m, [section]: { text: r.error, ok: false } }));
      else {
        setMessages((m) => ({ ...m, [section]: { text: okText, ok: true } }));
        done?.(r);
      }
      router.refresh();
    });
  }

  function onForm(section: string, action: (fd: FormData) => Promise<AdminResult>) {
    return (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fd = new FormData(form);
      run(section, () => action(fd), () => form.reset());
    };
  }

  function msg(section: string) {
    const m = messages[section];
    if (!m) return null;
    return (
      <p className={m.ok ? "ok" : "notice"} role={m.ok ? "status" : "alert"}>
        {m.text}
      </p>
    );
  }

  async function shareInvite() {
    if (!inviteLink) return;
    const text = `${inviteLink.name}님, 교회 지출청구 초대 링크입니다. 본인 휴대폰에서 열고 휴대폰 번호 뒤 4자리를 넣어 주세요.`;
    if (navigator.share) {
      await navigator.share({ title: "교회 지출청구 초대", text, url: inviteLink.url }).catch(() => undefined);
    } else {
      await navigator.clipboard?.writeText(`${text}\n${inviteLink.url}`).catch(() => undefined);
      setCopied(true);
    }
  }

  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const deptOf = new Map(departments.map((d) => [d.id, d.name]));
  const current = positions.filter((p) => p.starts_on <= today && (!p.ends_on || p.ends_on >= today));

  return (
    <div className="stack">
      <section className="card stack">
        <h2 className="subtitle">막힌 건 {stuck.length}건</h2>
        {stuck.length === 0 && <p className="muted">막힌 청구서가 없습니다.</p>}
        <ul className="list">
          {stuck.map((s) => (
            <li key={s.claim_id} className="stack" style={{ padding: "10px 0" }}>
              <span>
                <strong>{s.claim_no ?? "작성 중"}</strong> · {s.department} · {PROBLEM[s.problem] ?? s.problem}
                {s.waiting_on ? ` · ${s.waiting_on}님 차례` : ""} · {s.days_waiting}일째
              </span>
              {s.status === "in_review" && reassign?.claimId !== s.claim_id && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={pending}
                  onClick={() => setReassign({ claimId: s.claim_id, reason: "" })}
                >
                  현재 직책자에게 다시 배정
                </button>
              )}
              {reassign?.claimId === s.claim_id && (
                <div className="stack">
                  <label className="field">
                    <span>바꾸는 이유 (예: 장기 출타)</span>
                    <input
                      id={`reassign-reason-${s.claim_id}`}
                      value={reassign.reason}
                      maxLength={300}
                      onChange={(e) => setReassign({ claimId: s.claim_id, reason: e.target.value })}
                    />
                  </label>
                  <div className="btn-row">
                    <button type="button" className="btn btn-ghost" onClick={() => setReassign(null)} disabled={pending}>
                      돌아가기
                    </button>
                    <button
                      type="button"
                      className="btn btn-main"
                      disabled={pending || !reassign.reason.trim()}
                      onClick={() => run("stuck", () => reassignStep(s.claim_id, s.version, reassign.reason), () => setReassign(null))}
                    >
                      다시 배정
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
        {msg("stuck")}
        <p className="muted">막힌 건은 해당 분께 직접 연락하거나, 직책을 바꾼 뒤 다시 배정합니다.</p>
      </section>

      <section className="card stack">
        <h2 className="subtitle">사람</h2>
        {inviteLink && (
          <div className="notice stack">
            <span>{inviteLink.name}님 초대 링크 (7일 유효):</span>
            <code style={{ wordBreak: "break-all" }}>{inviteLink.url}</code>
            <span className="muted">받는 분은 링크를 열고 휴대폰 번호 뒤 4자리를 넣습니다.</span>
            <button type="button" className="btn btn-main" onClick={shareInvite}>
              카톡·문자로 보내기
            </button>
            {copied && <span role="status">복사했습니다. 카톡이나 문자에 붙여 넣어 주세요.</span>}
          </div>
        )}
        <ul className="list">
          {people.map((p) => (
            <li key={p.id} className="stack" style={{ padding: "10px 0", gap: 6 }}>
              <span>
                <strong>{p.name}</strong> · {STATUS[p.status] ?? p.status} · 휴대폰 끝 {p.phone_last4}
                {p.has_email ? "" : " · 메일 없음"}
                {p.needs_in_person_check
                  ? p.in_person_checked_at
                    ? ` · 대면 확인됨 ${formatChurchDateTime(p.in_person_checked_at)}`
                    : " · 대면 확인 필요"
                  : ""}
              </span>
              <div className="chips">
                {p.logins === 0 && p.status !== "suspended" && (
                  <button
                    type="button"
                    className="chip"
                    disabled={pending}
                    onClick={() =>
                      run(
                        "people",
                        () => createInvite(p.id),
                        (r) => {
                          if (r.ok && r.value) {
                            setCopied(false);
                            setInviteLink({ name: p.name, url: r.value });
                          }
                        },
                        "초대 링크를 만들었습니다.",
                      )
                    }
                  >
                    초대 링크 만들기
                  </button>
                )}
                {p.logins > 0 &&
                  p.id !== meId &&
                  p.status !== "suspended" &&
                  (p.status === "pending" || (p.needs_in_person_check && !p.in_person_checked_at)) && (
                    <button type="button" className="chip" disabled={pending} onClick={() => run("people", () => confirmInPerson(p.id))}>
                      대면 확인 완료
                    </button>
                  )}
                {p.status === "suspended" && p.id !== meId && (
                  <button type="button" className="chip" disabled={pending} onClick={() => run("people", () => reactivatePerson(p.id))}>
                    정지 풀기
                  </button>
                )}
              </div>
              <div>
                {p.status !== "suspended" && p.id !== meId && (
                  <button type="button" className="link-danger" disabled={pending} onClick={() => setSuspendTarget(p)}>
                    정지…
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {msg("people")}
        {suspendTarget && (
          <ConfirmSheet
            title={`${suspendTarget.name}님을 정지합니다. 이 분 차례의 결재가 멈춥니다.`}
            titleEn="Suspend this person? Claims waiting on them will stop."
            confirmLabel="정지"
            confirmLabelEn="Suspend"
            danger
            pending={pending}
            onCancel={() => setSuspendTarget(null)}
            onConfirm={() => {
              const target = suspendTarget;
              run("people", () => suspendPerson(target.id), () => setSuspendTarget(null));
            }}
          />
        )}
        <form onSubmit={onForm("person-form", createPerson)} className="stack">
          <h3 className="subtitle">사람 등록</h3>
          <label className="field">
            <span>이름</span>
            <input id="person-name" name="name" required maxLength={50} />
          </label>
          <label className="field">
            <span>수표용 영문 이름</span>
            <input id="person-legal" name="legalNameEn" maxLength={100} />
          </label>
          <label className="field">
            <span>휴대폰 번호</span>
            <input id="person-phone" name="phone" inputMode="tel" required placeholder="(213) 555-0100" />
          </label>
          <label className="field">
            <span>이메일 (선택)</span>
            <input id="person-email" name="email" type="email" />
          </label>
          <label className="field">
            <span>직분 (선택)</span>
            <input id="person-title" name="title" maxLength={20} />
          </label>
          <label className="choice">
            <input type="checkbox" name="approver" /> <span>결재자·재정부·관리자 (대면 확인 필요)</span>
          </label>
          {msg("person-form")}
          <button className="btn btn-main" disabled={pending}>
            등록
          </button>
        </form>
      </section>

      <section className="card stack">
        <h2 className="subtitle">현재 직책</h2>
        <ul className="list">
          {current.map((p) => (
            <li key={p.id} className="row-link">
              <span>
                {deptOf.get(p.department_id)} · {ROLE[p.role] ?? p.role}
              </span>
              <span>{nameOf.get(p.person_id)}</span>
            </li>
          ))}
        </ul>
        <form onSubmit={onForm("position-form", assignPosition)} className="stack">
          <h3 className="subtitle">직책 배정</h3>
          <label className="field">
            <span>사람</span>
            <select id="pos-person" name="person" required>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>부서</span>
            <select id="pos-dept" name="department" required>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>직책</span>
            <select id="pos-role" name="role" required>
              {Object.entries(ROLE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <div className="btn-row">
            <label className="field">
              <span>시작일</span>
              <input id="pos-start" name="startsOn" type="date" required defaultValue={today} />
            </label>
            <label className="field">
              <span>종료일 (선택)</span>
              <input id="pos-end" name="endsOn" type="date" />
            </label>
          </div>
          {msg("position-form")}
          <button className="btn btn-main" disabled={pending}>
            배정
          </button>
        </form>
      </section>

      <section className="card stack">
        <h2 className="subtitle">부서</h2>
        <ul className="list">
          {departments.map((d) => (
            <li key={d.id} className="row-link">
              <span>
                {d.name}
                {d.parent_id ? ` (${deptOf.get(d.parent_id)} 아래)` : ""}
              </span>
              <span className="muted">{d.is_finance ? "재정부" : ""}</span>
            </li>
          ))}
        </ul>
        <form onSubmit={onForm("dept-form", createDepartment)} className="stack">
          <h3 className="subtitle">부서 추가</h3>
          <label className="field">
            <span>이름</span>
            <input id="dept-name" name="name" required maxLength={50} />
          </label>
          <label className="field">
            <span>영문 이름 (선택)</span>
            <input id="dept-name-en" name="nameEn" maxLength={80} />
          </label>
          <label className="field">
            <span>위원회 (상위 부서)</span>
            <select id="dept-parent" name="parent" defaultValue="">
              <option value="">없음</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="choice">
            <input type="checkbox" name="isFinance" /> <span>재정부</span>
          </label>
          {msg("dept-form")}
          <button className="btn btn-main" disabled={pending}>
            추가
          </button>
        </form>
      </section>
    </div>
  );
}
