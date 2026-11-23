"use client";

import { useEffect, useState, useTransition } from "react";
import { ConfirmSheet } from "@/app/components/confirm-sheet";
import { formatChurchDateTime } from "@/lib/time";
import { useRouter } from "next/navigation";
import {
  assignPosition,
  cancelClaimAsAdmin,
  confirmInPerson,
  createDepartment,
  createInvite,
  createPerson,
  endPosition,
  getPersonDetail,
  grantRole,
  reactivatePerson,
  reassignStep,
  relinkPerson,
  revokeGrant,
  suspendPerson,
  updatePerson,
  type AdminResult,
  type PersonDetail,
} from "./actions";

type Stuck = {
  claim_id: string;
  claim_no: string | null;
  department: string;
  status: string;
  author: string;
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
  login_methods: string | null;
};
type AuthorWaiting = {
  claim_id: string;
  claim_no: string | null;
  department: string;
  author: string;
  author_status: string;
  status: string;
  days_waiting: number;
  version: number;
};
type Grant = { id: string; person_id: string; name: string; grant_kind: string; basis: string | null; granted_at: string };

const PROVIDER: Record<string, string> = { email: "메일 코드", kakao: "카카오" };
const GRANT: Record<string, string> = { admin: "관리자", auditor: "감사위원" };

function methods(list: string | null): string {
  if (!list) return "";
  return list
    .split(", ")
    .map((x) => PROVIDER[x] ?? x)
    .join("·");
}
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
  authorWaiting: AuthorWaiting[];
  grants: Grant[];
};

/** A reason box with a confirm button, used for actions that go into the audit log. */
function ReasonForm(props: {
  id: string;
  label: string;
  confirm: string;
  pending: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="stack">
      <label className="field">
        <span>{props.label}</span>
        <input id={props.id} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="btn-row">
        <button type="button" className="btn btn-ghost" onClick={props.onCancel} disabled={props.pending}>
          돌아가기
        </button>
        <button
          type="button"
          className={props.danger ? "btn btn-danger" : "btn btn-main"}
          disabled={props.pending || reason.trim().length < 5}
          onClick={() => props.onConfirm(reason)}
        >
          {props.confirm}
        </button>
      </div>
    </div>
  );
}

export function AdminPanels({ meId, today, stuck, people, departments, positions, authorWaiting, grants }: Props) {
  const router = useRouter();
  // Messages are shown inside the section that caused them, not at the top of a long page.
  const [messages, setMessages] = useState<Record<string, { text: string; ok: boolean }>>({});
  const [inviteLink, setInviteLink] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<Person | null>(null);
  const [reassign, setReassign] = useState<{ claimId: string; reason: string } | null>(null);
  const [ending, setEnding] = useState<{ positionId: string; endsOn: string } | null>(null);
  const [relinkTarget, setRelinkTarget] = useState<string | null>(null);
  const [editing, setEditing] = useState<PersonDetail | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState<string | null>(null);
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

  async function copyClaimLink(claimId: string) {
    const url = `${window.location.origin}/claims/${claimId}`;
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setLinkCopied(claimId);
  }

  function openEdit(personId: string) {
    setMessages((m) => ({ ...m, people: undefined as never }));
    start(async () => {
      const r = await getPersonDetail(personId);
      if (r.ok) setEditing(r.person);
      else setMessages((m) => ({ ...m, people: { text: r.error, ok: false } }));
    });
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
                <strong>{s.claim_no ?? "작성 중"}</strong> · {s.department} · 작성 {s.author}님 · {PROBLEM[s.problem] ?? s.problem}
                {s.waiting_on ? ` · ${s.waiting_on === "재정부" ? "재정부" : `${s.waiting_on}님`} 차례` : ""} · {s.days_waiting}일째
              </span>
              <div>
                <button type="button" className="chip" onClick={() => copyClaimLink(s.claim_id)}>
                  청구서 링크 복사
                </button>
                {linkCopied === s.claim_id && (
                  <span role="status" className="muted">
                    {" "}
                    복사했습니다. 카톡으로 보내 주세요.
                  </span>
                )}
              </div>
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

      {authorWaiting.length > 0 && (
        <section className="card stack">
          <h2 className="subtitle">작성자 차례인 청구서 {authorWaiting.length}건</h2>
          <p className="muted">보완 요청을 받고 30일 넘게 그대로이거나, 작성자가 정지된 청구서입니다. 메일은 가지 않습니다.</p>
          <ul className="list">
            {authorWaiting.map((w) => (
              <li key={w.claim_id} className="stack" style={{ padding: "10px 0" }}>
                <span>
                  <strong>{w.claim_no}</strong> · {w.department} · {w.author}님
                  {w.author_status !== "active" ? ` (${STATUS[w.author_status] ?? w.author_status})` : ""} · {w.days_waiting}일째
                </span>
                {w.author_status !== "active" &&
                  (cancelTarget === w.claim_id ? (
                    <ReasonForm
                      id={`cancel-reason-${w.claim_id}`}
                      label="취소 이유 (예: 교회를 떠나심, 같은 청구 중복)"
                      confirm="청구 취소"
                      danger
                      pending={pending}
                      onCancel={() => setCancelTarget(null)}
                      onConfirm={(reason) =>
                        run("author-waiting", () => cancelClaimAsAdmin(w.claim_id, w.version, reason), () => setCancelTarget(null), "취소했습니다.")
                      }
                    />
                  ) : (
                    <div>
                      <button type="button" className="link-danger" disabled={pending} onClick={() => setCancelTarget(w.claim_id)}>
                        사무실에서 취소…
                      </button>
                    </div>
                  ))}
              </li>
            ))}
          </ul>
          {msg("author-waiting")}
        </section>
      )}

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
                {p.login_methods ? ` · 로그인: ${methods(p.login_methods)}` : ""}
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
              {p.id !== meId && (
                <div className="chips">
                  <button type="button" className="chip" disabled={pending} onClick={() => openEdit(p.id)}>
                    정보 고치기
                  </button>
                  {p.logins > 0 && p.status !== "suspended" && relinkTarget !== p.id && (
                    <button type="button" className="chip" disabled={pending} onClick={() => setRelinkTarget(p.id)}>
                      로그인 다시 연결
                    </button>
                  )}
                </div>
              )}
              {relinkTarget === p.id && (
                <div className="stack notice-card card">
                  <p>
                    지금 로그인 연결을 지우고 새 초대 링크로 다시 연결합니다.
                    {p.needs_in_person_check ? " 결재 관계자라 대면 확인을 다시 해야 합니다." : ""}
                  </p>
                  <ReasonForm
                    id={`relink-reason-${p.id}`}
                    label="이유 (예: 휴대폰을 바꾸심, 다른 방법으로 로그인하심)"
                    confirm="연결 지우기"
                    danger
                    pending={pending}
                    onCancel={() => setRelinkTarget(null)}
                    onConfirm={(reason) =>
                      run(
                        "people",
                        () => relinkPerson(p.id, reason),
                        () => setRelinkTarget(null),
                        "연결을 지웠습니다. '초대 링크 만들기'로 새 링크를 보내 주세요.",
                      )
                    }
                  />
                </div>
              )}
              {editing?.id === p.id && (
                <form
                  className="stack card"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    run("people", () => updatePerson(fd), () => setEditing(null), "고쳤습니다.");
                  }}
                >
                  <input type="hidden" name="person" value={editing.id} />
                  <label className="field">
                    <span>이름</span>
                    <input id="edit-name" name="name" required maxLength={50} defaultValue={editing.name} />
                  </label>
                  <label className="field">
                    <span>수표용 영문 이름</span>
                    <input id="edit-legal" name="legalNameEn" maxLength={100} defaultValue={editing.legal_name_en ?? ""} />
                  </label>
                  <label className="field">
                    <span>휴대폰 번호</span>
                    <input id="edit-phone" name="phone" inputMode="tel" required defaultValue={editing.phone_e164 ?? ""} />
                  </label>
                  <label className="field">
                    <span>이메일</span>
                    <input id="edit-email" name="email" type="email" defaultValue={editing.email ?? ""} />
                  </label>
                  <label className="field">
                    <span>직분</span>
                    <input id="edit-title" name="title" maxLength={20} defaultValue={editing.church_title ?? ""} />
                  </label>
                  {editing.login_methods && (
                    <label className="field">
                      <span>고치는 이유 (로그인이 연결된 분은 꼭 적습니다)</span>
                      <input id="edit-reason" name="reason" maxLength={300} required minLength={5} />
                    </label>
                  )}
                  <p className="muted">휴대폰 번호를 바꾸면 보낸 초대 링크는 쓸 수 없게 됩니다. 이미 올린 청구서의 수표 이름은 바뀌지 않습니다.</p>
                  <div className="btn-row">
                    <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)} disabled={pending}>
                      돌아가기
                    </button>
                    <button className="btn btn-main" disabled={pending}>
                      저장
                    </button>
                  </div>
                </form>
              )}
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
            <li key={p.id} className="stack" style={{ padding: "10px 0", gap: 6 }}>
              <div className="row-link" style={{ padding: 0 }}>
                <span>
                  {deptOf.get(p.department_id)} · {ROLE[p.role] ?? p.role}
                  {p.ends_on ? <span className="muted"> · {p.ends_on}까지</span> : null}
                </span>
                <span>{nameOf.get(p.person_id)}</span>
              </div>
              {ending?.positionId === p.id ? (
                <div className="stack">
                  <label className="field">
                    <span>마지막 날 (이날까지 직책 유지)</span>
                    <input
                      id={`end-${p.id}`}
                      type="date"
                      min={p.starts_on}
                      value={ending.endsOn}
                      onChange={(e) => setEnding({ positionId: p.id, endsOn: e.target.value })}
                    />
                  </label>
                  <div className="btn-row">
                    <button type="button" className="btn btn-ghost" onClick={() => setEnding(null)} disabled={pending}>
                      돌아가기
                    </button>
                    <button
                      type="button"
                      className="btn btn-main"
                      disabled={pending || !ending.endsOn}
                      onClick={() => run("positions", () => endPosition(p.id, ending.endsOn), () => setEnding(null))}
                    >
                      직책 끝내기
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <button type="button" className="chip" disabled={pending} onClick={() => setEnding({ positionId: p.id, endsOn: today })}>
                    직책 끝내기
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {msg("positions")}
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
          <p className="muted">
            직책을 넘겨줄 때: 이전 분의 직책을 먼저 끝내고(마지막 날), 새 분은 그다음 날부터 시작합니다. 같은 날이 겹치면 저장되지 않습니다.
          </p>
          {msg("position-form")}
          <button className="btn btn-main" disabled={pending}>
            배정
          </button>
        </form>
      </section>

      <section className="card stack">
        <h2 className="subtitle">관리자·감사위원 권한</h2>
        <ul className="list">
          {grants.map((g) => (
            <li key={g.id} className="stack" style={{ padding: "10px 0", gap: 6 }}>
              <span>
                <strong>{g.name}</strong> · {GRANT[g.grant_kind] ?? g.grant_kind}
                {g.basis ? <span className="muted"> · 근거: {g.basis}</span> : null}
              </span>
              {g.person_id !== meId &&
                (revokeTarget === g.id ? (
                  <ReasonForm
                    id={`revoke-reason-${g.id}`}
                    label="거두는 이유"
                    confirm="권한 거두기"
                    danger
                    pending={pending}
                    onCancel={() => setRevokeTarget(null)}
                    onConfirm={(reason) => run("grants", () => revokeGrant(g.id, reason), () => setRevokeTarget(null))}
                  />
                ) : (
                  <div>
                    <button type="button" className="link-danger" disabled={pending} onClick={() => setRevokeTarget(g.id)}>
                      권한 거두기…
                    </button>
                  </div>
                ))}
            </li>
          ))}
        </ul>
        {msg("grants")}
        <form onSubmit={onForm("grant-form", grantRole)} className="stack">
          <h3 className="subtitle">권한 주기</h3>
          <p className="muted">대면 확인을 마친 분에게만 줄 수 있습니다. 감사위원은 관리자·재정 담당과 겸할 수 없습니다.</p>
          <label className="field">
            <span>사람</span>
            <select id="grant-person" name="person" required>
              {people
                .filter((p) => p.id !== meId && p.status === "active")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>권한</span>
            <select id="grant-kind" name="kind" required>
              <option value="admin">관리자</option>
              <option value="auditor">감사위원</option>
            </select>
          </label>
          <label className="field">
            <span>근거 (예: 2026-12-07 당회 결의)</span>
            <input id="grant-basis" name="basis" required minLength={5} maxLength={300} />
          </label>
          {msg("grant-form")}
          <button className="btn btn-main" disabled={pending}>
            권한 주기
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
