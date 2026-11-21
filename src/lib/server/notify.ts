import "server-only";
import { createServiceClient } from "@/lib/server/admin";
import { serverEnv } from "@/lib/server/env";

// Email delivery for rows that SQL functions queued in public.notifications
// (decision D4). This is the only place that uses the service-role key. Rows are
// claimed with status 'sending' first so the cron job and a Server Action never
// send the same email twice. A failed email never blocks the approval itself.

type Kind =
  | "review_requested"
  | "changes_requested"
  | "finance_requested"
  | "you_approved"
  | "approved_all"
  | "documents_verified"
  | "documents_requested"
  | "check_issued";

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
    body: "수표가 발행되었습니다. 주일에 재정부에서 받으시거나 우편으로 받습니다. / Your check has been issued.",
  },
};

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const key = serverEnv.resendApiKey;
  if (!key) {
    // Local development: print instead of sending.
    console.info(`[mail] to=${to} subject=${subject}\n${text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: serverEnv.mailFrom, to, subject, text }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`mail provider ${res.status}`);
}

type Row = { id: string; claim_id: string | null; recipient_id: string; kind: string; attempts: number };

async function deliver(rows: Row[]) {
  if (rows.length === 0) return;
  const db = createServiceClient();
  const recipientIds = [...new Set(rows.map((r) => r.recipient_id))];
  const claimIds = [...new Set(rows.map((r) => r.claim_id).filter((x): x is string => !!x))];
  const [{ data: people }, { data: claims }] = await Promise.all([
    db.from("people").select("id, email, status").in("id", recipientIds),
    claimIds.length ? db.from("claims").select("id, claim_no").in("id", claimIds) : Promise.resolve({ data: [] }),
  ]);
  const emailOf = new Map((people ?? []).map((p) => [p.id, p.status === "active" ? p.email : null]));
  const noOf = new Map((claims ?? []).map((c) => [c.id, c.claim_no ?? ""]));

  for (const row of rows) {
    const email = emailOf.get(row.recipient_id);
    const template = TEMPLATES[row.kind as Kind];
    if (!template) {
      await db.from("notifications").update({ status: "skipped", error: "unknown kind" }).eq("id", row.id);
      continue;
    }
    if (!email) {
      // Shown on the admin "stuck" list so the office can call instead.
      await db.from("notifications").update({ status: "no_address" }).eq("id", row.id);
      continue;
    }
    const link = row.claim_id ? `${siteUrl()}/claims/${row.claim_id}` : siteUrl();
    try {
      await sendEmail(email, template.subject(noOf.get(row.claim_id ?? "") ?? ""), `${template.body}\n\n${link}`);
      await db.from("notifications").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", row.id);
    } catch (err) {
      const attempts = row.attempts + 1;
      await db
        .from("notifications")
        .update({ status: attempts >= 3 ? "failed" : "pending", attempts, error: String(err).slice(0, 300) })
        .eq("id", row.id);
    }
  }
}

/** Send what a transition just queued for one claim. Never throws. */
export async function dispatchClaimNotifications(claimId: string): Promise<void> {
  try {
    const db = createServiceClient();
    const { data } = await db
      .from("notifications")
      .update({ status: "sending" })
      .eq("claim_id", claimId)
      .eq("status", "pending")
      .select("id, claim_id, recipient_id, kind, attempts");
    await deliver((data ?? []) as Row[]);
  } catch (err) {
    console.error("[notify] dispatch failed", err);
  }
}

/** Cron: retry everything still pending (including rows a crashed request left). */
export async function dispatchAllPending(): Promise<number> {
  const db = createServiceClient();
  // Rows stuck in 'sending' for more than 10 minutes are retried.
  await db
    .from("notifications")
    .update({ status: "pending" })
    .eq("status", "sending")
    .lt("created_at", new Date(Date.now() - 10 * 60_000).toISOString());
  const { data } = await db
    .from("notifications")
    .update({ status: "sending" })
    .eq("status", "pending")
    .select("id, claim_id, recipient_id, kind, attempts");
  await deliver((data ?? []) as Row[]);
  return data?.length ?? 0;
}
