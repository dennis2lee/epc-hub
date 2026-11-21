"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  assignPosition,
  confirmInPerson,
  createDepartment,
  createInvite,
  createPerson,
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
  phone_e164: string | null;
  email: string | null;
  status: string;
  needs_in_person_check: boolean;
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
  const [message, setMessage] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<{ name: string; url: string } | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<AdminResult>, done?: (r: AdminResult) => void) {
    setMessage(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setMessage(r.error);
      else done?.(r);
      router.refresh();
    });
  }

  function onForm(action: (fd: FormData) => Promise<AdminResult>) {
    return (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fd = new FormData(form);
      run(() => action(fd), () => form.reset());
    };
  }

  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const deptOf = new Map(departments.map((d) => [d.id, d.name]));
  const current = positions.filter((p) => p.starts_on <= today && (!p.ends_on || p.ends_on >= today));

  return (
    <div className="stack">
      {message && <p className="notice">{message}</p>}

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
              {s.status === "in_review" && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={pending}
                  onClick={() => {
                    const reason = window.prompt("결재자를 바꾸는 이유를 적어 주세요 (예: 장기 출타)");
                    if (reason) run(() => reassignStep(s.claim_id, s.version, reason));
                  }}
                >
                  현재 직책자에게 다시 배정
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="muted">막힌 건은 해당 분께 직접 연락하거나, 직책을 바꾼 뒤 다시 배정합니다.</p>
      </section>

      <section className="card stack">
        <h2 className="subtitle">사람</h2>
        {inviteLink && (
          <div className="notice stack">
            <span>{inviteLink.name}님 초대 링크 (7일 유효):</span>
            <code style={{ wordBreak: "break-all" }}>{inviteLink.url}</code>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => navigator.clipboard?.writeText(inviteLink.url).catch(() => undefined)}
            >
              링크 복사
            </button>
          </div>
        )}
        <ul className="list">
          {people.map((p) => (
            <li key={p.id} className="stack" style={{ padding: "10px 0", gap: 6 }}>
              <span>
                <strong>{p.name}</strong> · {STATUS[p.status] ?? p.status} · {p.phone_e164}
                {p.needs_in_person_check ? " · 대면 확인 대상" : ""}
              </span>
              <div className="chips">
                {p.logins === 0 && p.status !== "suspended" && (
                  <button
                    type="button"
                    className="chip"
                    disabled={pending}
                    onClick={() => run(() => createInvite(p.id), (r) => r.ok && r.value && setInviteLink({ name: p.name, url: r.value }))}
                  >
                    초대 링크 만들기
                  </button>
                )}
                {p.logins > 0 && p.id !== meId && (p.status === "pending" || p.needs_in_person_check) && (
                  <button type="button" className="chip" disabled={pending} onClick={() => run(() => confirmInPerson(p.id))}>
                    대면 확인 완료
                  </button>
                )}
                {p.status !== "suspended" && p.id !== meId && (
                  <button type="button" className="chip" disabled={pending} onClick={() => run(() => suspendPerson(p.id))}>
                    정지
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <form onSubmit={onForm(createPerson)} className="stack">
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
          <label>
            <input type="checkbox" name="approver" /> 결재자·재정부·관리자 (대면 확인 필요)
          </label>
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
        <form onSubmit={onForm(assignPosition)} className="stack">
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
        <form onSubmit={onForm(createDepartment)} className="stack">
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
          <label>
            <input type="checkbox" name="isFinance" /> 재정부
          </label>
          <button className="btn btn-main" disabled={pending}>
            추가
          </button>
        </form>
      </section>
    </div>
  );
}
