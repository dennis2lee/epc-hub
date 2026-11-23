import "server-only";
import { createServiceClient } from "@/lib/server/admin";
import { serverEnv } from "@/lib/server/env";
import { formatCents } from "@/lib/money";

// Email delivery for rows that SQL functions queued in public.notifications
// (decision D4). Rows are claimed with status 'sending' and a claim time first,
// so the cron job and a Server Action do not send the same row twice; a row is
// taken back only when its claim is older than CLAIM_TIMEOUT. The provider also
// receives the row id as an idempotency key. A failed email never blocks the
// approval itself.

type Kind =
  | "review_requested"
  | "changes_requested"
  | "finance_requested"
  | "you_approved"
  | "approved_all"
  | "documents_verified"
  | "documents_requested"
  | "check_issued"
  | "check_voided"
  | "email_changed"
  | "login_reset";

const TEMPLATES: Record<Kind, { subject: (no: string) => string; body: string }> = {
  review_requested: {
    subject: (no) => `[교회 지출청구] 살펴봐 주실 청구서가 있습니다 (${no})`,
    body: "지출청구서를 올렸습니다. 살펴봐 주시면 감사하겠습니다. / A claim is waiting for your review.",
  },
  changes_requested: {
    subject: (no) => `[교회 지출청구] 청구서 보완 요청 (${no})`,
    body: "청구서에 보완 요청이 있습니다. 사유를 확인하고 고쳐서 다시 올려 주세요. / Changes were requested.",
  },
  documents_requested: {
    subject: (no) => `[교회 지출청구] 서류 보완 요청 (${no})`,
    body: "재정부에서 서류 보완을 요청했습니다. 사유를 확인해 주세요. / Finance requested documents.",
  },
  finance_requested: {
    subject: (no) => `[교회 지출청구] 서류 확인이 필요한 청구서 (${no})`,
    body: "결재가 끝난 청구서입니다. 서류를 확인하고 수표를 준비해 주세요. / Approved claim awaiting finance.",
  },
  you_approved: {
    subject: (no) => `[교회 지출청구] 승인하셨습니다 (${no})`,
    body: "방금 이 청구서를 승인하셨습니다. 본인이 승인하지 않았다면 사무실에 바로 알려 주세요. / You approved this claim.",
  },
  approved_all: {
    subject: (no) => `[교회 지출청구] 결재가 끝났습니다 (${no})`,
    body: "부장과 담당 장로의 결재가 끝나 재정부로 넘어갔습니다. / Your claim was approved and sent to finance.",
  },
  documents_verified: {
    subject: (no) => `[교회 지출청구] 서류 확인이 끝났습니다 (${no})`,
    body: "재정부가 서류를 확인했습니다. 수표가 발행되면 다시 알려 드립니다. / Finance verified your documents.",
  },
  check_issued: {
    subject: (no) => `[교회 지출청구] 수표가 발행되었습니다 (${no})`,
    body: "수표가 발행되었습니다. / Your check has been issued.",
  },
  check_voided: {
    subject: (no) => `[교회 지출청구] 수표가 무효 처리되었습니다 (${no})`,
    body:
      "재정부가 발행한 수표를 무효 처리했습니다. 새 수표를 준비하면 다시 알려 드립니다. 받으신 수표가 있으면 재정부에 돌려주세요. / " +
      "Your check was voided; a new one will follow. Please return the old check if you have it.",
  },
  login_reset: {
    subject: () => "[교회 지출청구] 로그인 연결이 초기화되었습니다",
    body:
      "사무실에서 교회 지출청구의 로그인 연결을 초기화했습니다. 새 초대 링크로 다시 연결해 주세요. 요청한 적이 없다면 사무실에 바로 알려 주세요. / " +
      "The office reset your sign-in. Please reconnect with the new invite link. If you did not ask for this, call the church office.",
  },
  email_changed: {
    subject: () => "[교회 지출청구] 알림 메일 주소가 바뀌었습니다",
    body:
      "교회 지출청구의 알림 메일 주소가 다른 주소로 바뀌었습니다. 본인이 바꾸지 않았다면 사무실에 바로 알려 주세요. / " +
      "Your notification email was changed. If this was not you, please call the church office.",
  },
};

const CLAIM_TIMEOUT_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
const COLUMNS = "id, claim_id, recipient_id, kind, attempts, to_address";

export async function sendEmail(to: string, subject: string, text: string, idempotencyKey?: string): Promise<void> {
  const key = serverEnv.resendApiKey;
  if (!key) {
    // Local development: print instead of sending.
    console.info(`[mail] to=${to} subject=${subject}\n${text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({ from: serverEnv.mailFrom, to, subject, text }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`mail provider ${res.status}`);
}

type Row = {
  id: string;
  claim_id: string | null;
  recipient_id: string;
  kind: string;
  attempts: number;
  to_address: string | null;
};

async function deliver(rows: Row[]) {
  if (rows.length === 0) return;
  const db = createServiceClient();
  const recipientIds = [...new Set(rows.map((r) => r.recipient_id))];
  const claimIds = [...new Set(rows.map((r) => r.claim_id).filter((x): x is string => !!x))];
  const [peopleRes, claimsRes] = await Promise.all([
    db.from("people").select("id, email, status").in("id", recipientIds),
    claimIds.length
      ? db.from("claims").select("id, claim_no, purpose, total_cents, check_delivery, author_id").in("id", claimIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (peopleRes.error || claimsRes.error) {
    // A lookup failure is temporary: give the rows back instead of marking them.
    await db.from("notifications").update({ status: "pending", claimed_at: null }).in("id", rows.map((r) => r.id)).eq("status", "sending");
    return;
  }
  const emailOf = new Map((peopleRes.data ?? []).map((p) => [p.id, p.status === "active" ? p.email : null]));
  const claimOf = new Map((claimsRes.data ?? []).map((c) => [c.id, c]));
  // Author names for the summary line, so a mail is recognisable at a glance.
  const authorIds = [...new Set((claimsRes.data ?? []).map((c) => c.author_id))];
  const { data: authors } = authorIds.length
    ? await db.from("people").select("id, name").in("id", authorIds)
    : { data: [] as { id: string; name: string }[] };
  const authorName = new Map((authors ?? []).map((a) => [a.id, a.name]));

  for (const row of rows) {
    const mine = db.from("notifications");
    const template = TEMPLATES[row.kind as Kind];
    if (!template) {
      await mine.update({ status: "skipped", error: "unknown kind" }).eq("id", row.id).eq("status", "sending");
      continue;
    }
    const email = row.to_address ?? emailOf.get(row.recipient_id);
    if (!email) {
      // Shown on the admin "stuck" list (problem notify_failed) so the office can call instead.
      await mine.update({ status: "no_address" }).eq("id", row.id).eq("status", "sending");
      continue;
    }
    const link = row.claim_id ? `${serverEnv.appOrigin}/claims/${row.claim_id}` : serverEnv.appOrigin;
    const c = row.claim_id ? claimOf.get(row.claim_id) : undefined;
    const summary = c
      ? `${authorName.get(c.author_id) ?? ""}님 · ${formatCents(Number(c.total_cents))} · ${c.purpose}`.slice(0, 120)
      : "";
    const delivery =
      row.kind === "check_issued" && c
        ? c.check_delivery === "mail"
          ? "\n수표는 우편으로 보내 드립니다. / The check will be mailed to you."
          : "\n수표는 주일에 재정부에서 받으세요. / Please pick up the check from finance on Sunday."
        : "";
    const subject = template.subject(c?.claim_no ?? "") + (summary ? ` ${summary}` : "");
    const text = `${summary ? `${summary}\n\n` : ""}${template.body}${delivery}\n\n${link}`;
    try {
      await sendEmail(email, subject, text, row.id);
      await mine.update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", row.id).eq("status", "sending");
    } catch (err) {
      const attempts = row.attempts + 1;
      await mine
        .update({ status: attempts >= MAX_ATTEMPTS ? "failed" : "pending", attempts, claimed_at: null, error: String(err).slice(0, 300) })
        .eq("id", row.id)
        .eq("status", "sending");
    }
  }
}

async function claim(filter: { claimId?: string }): Promise<Row[]> {
  const db = createServiceClient();
  let q = db
    .from("notifications")
    .update({ status: "sending", claimed_at: new Date().toISOString() })
    .eq("status", "pending");
  if (filter.claimId) q = q.eq("claim_id", filter.claimId);
  const { data } = await q.select(COLUMNS);
  return (data ?? []) as Row[];
}

/** Send what a transition just queued for one claim. Never throws. */
export async function dispatchClaimNotifications(claimId: string): Promise<void> {
  try {
    await deliver(await claim({ claimId }));
  } catch (err) {
    console.error("[notify] dispatch failed", err);
  }
}

/** Send a person-level notice (no claim), e.g. email_changed. Never throws. */
export async function dispatchPersonNotifications(personId: string): Promise<void> {
  try {
    const db = createServiceClient();
    const { data } = await db
      .from("notifications")
      .update({ status: "sending", claimed_at: new Date().toISOString() })
      .eq("status", "pending")
      .eq("recipient_id", personId)
      .is("claim_id", null)
      .select(COLUMNS);
    await deliver((data ?? []) as Row[]);
  } catch (err) {
    console.error("[notify] dispatch failed", err);
  }
}

/**
 * Names of people the latest transition of a claim will try to email but
 * cannot, because they have no address. Lets the screen say so at once.
 */
// Notices that tell someone else to act or that money is coming. "you_approved"
// goes to the actor themself and is not a hand-off.
const HANDOFF_KINDS = [
  "review_requested",
  "finance_requested",
  "changes_requested",
  "documents_requested",
  "check_ready",
  "check_issued",
  "check_voided",
];

export async function recipientsWithoutEmail(claimId: string): Promise<string[]> {
  const db = createServiceClient();
  const { data: rows } = await db
    .from("notifications")
    .select("recipient_id, kind")
    .eq("claim_id", claimId)
    .eq("status", "pending")
    .in("kind", HANDOFF_KINDS);
  const ids = [...new Set((rows ?? []).map((r) => r.recipient_id))];
  if (ids.length === 0) return [];
  const { data: people } = await db.from("people").select("name, email, status").in("id", ids);
  return (people ?? []).filter((p) => !p.email || p.status !== "active").map((p) => p.name);
}

/** Names of people who could not be emailed about this claim since `sinceIso`
 *  (no address, or sending failed). Used so a screen never claims "we emailed". */
export async function unreachableSince(claimId: string, sinceIso: string): Promise<string[]> {
  const db = createServiceClient();
  const { data: rows } = await db
    .from("notifications")
    .select("recipient_id, status")
    .eq("claim_id", claimId)
    .gte("created_at", sinceIso)
    .in("kind", HANDOFF_KINDS);
  if (!rows || rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.recipient_id))];
  const { data: people } = await db.from("people").select("id, name, email").in("id", ids);
  const byId = new Map((people ?? []).map((p) => [p.id, p]));
  const out = new Set<string>();
  for (const r of rows) {
    const p = byId.get(r.recipient_id);
    if (!p) continue;
    if (r.status === "no_address" || r.status === "failed" || !p.email) out.add(p.name);
  }
  return [...out];
}

/** Cron: retry pending rows and rows whose claim timed out. */
export async function dispatchAllPending(): Promise<number> {
  const db = createServiceClient();
  // Take back rows whose sender died; this counts as an attempt.
  const cutoff = new Date(Date.now() - CLAIM_TIMEOUT_MS).toISOString();
  const { data: stale } = await db
    .from("notifications")
    .select("id, attempts, claimed_at")
    .eq("status", "sending")
    .or(`claimed_at.is.null,claimed_at.lt.${cutoff}`);
  for (const s of stale ?? []) {
    const attempts = s.attempts + 1;
    await db
      .from("notifications")
      .update({ status: attempts >= MAX_ATTEMPTS ? "failed" : "pending", attempts, claimed_at: null })
      .eq("id", s.id)
      .eq("status", "sending")
      // Only if nobody re-claimed it in the meantime.
      .filter("claimed_at", s.claimed_at === null ? "is" : "eq", s.claimed_at ?? "null");
  }
  const rows = await claim({});
  await deliver(rows);
  return rows.length;
}
