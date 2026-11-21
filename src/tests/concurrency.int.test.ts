// Integration test: concurrent requests against the local stack. pgTAP runs in a
// single session, so races are exercised here with real parallel HTTP calls.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { loadLocalEnv } from "./env";

const env = loadLocalEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

async function signIn(email: string): Promise<{ client: SupabaseClient; uid: string }> {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const client = createClient(url, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { data, error: e2 } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (e2 || !data.user) throw e2 ?? new Error("no user");
  return { client, uid: data.user.id };
}

async function version(claimId: string): Promise<number> {
  const { data } = await admin.from("claims").select("version").eq("id", claimId).single();
  return data!.version;
}

/** Create, fill, attach a receipt and return the claim id (still a draft). */
async function draft(user: { client: SupabaseClient; uid: string }): Promise<string> {
  const dept = "10000000-0000-0000-0000-000000000002";
  const { data: id, error } = await user.client.rpc("create_claim", { p_department: dept });
  if (error) throw error;
  await user.client.rpc("save_claim_draft", {
    p_claim: id,
    p_version: 1,
    p_department: dept,
    p_purpose: "동시성 시험",
    p_attendees: "",
    p_expense_date: new Date().toISOString().slice(0, 10),
    p_check_delivery: "pickup",
    p_lines: [{ description: "x", amount_cents: 1000 }],
  });
  const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(randomUUID())]);
  const path = `${id}/${randomUUID()}.jpg`;
  // Receipts are uploaded by the server (service role), as in uploadReceipt.
  const up = await admin.storage.from("receipts").upload(path, bytes, { contentType: "image/jpeg" });
  if (up.error) throw up.error;
  const r = await admin.rpc("add_attachment_srv", {
    p_actor_auth: user.uid,
    p_claim: id,
    p_storage_path: path,
    p_sha256: createHash("sha256").update(bytes).digest("hex"),
    p_merchant: null,
    p_receipt_date: null,
    p_amount_cents: null,
  });
  if (r.error) throw r.error;
  return id as string;
}

describe("concurrency", () => {
  let writer: { client: SupabaseClient; uid: string };
  let head: { client: SupabaseClient; uid: string };
  let head2: { client: SupabaseClient; uid: string };

  beforeAll(async () => {
    writer = await signIn("writer@church.test");
    head = await signIn("head@church.test");
    head2 = await signIn("head@church.test"); // same person, second device
  });

  it("issues unique claim numbers under parallel submits", async () => {
    const ids = await Promise.all(Array.from({ length: 8 }, () => draft(writer)));
    const results = await Promise.all(
      ids.map(async (id) => writer.client.rpc("submit_claim", { p_claim: id, p_version: await version(id) })),
    );
    expect(results.every((r) => !r.error)).toBe(true);
    const { data } = await admin.from("claims").select("claim_no").in("id", ids);
    const numbers = (data ?? []).map((d) => d.claim_no);
    expect(new Set(numbers).size).toBe(ids.length);
  });

  it("applies only one of two simultaneous approvals of the same step", async () => {
    const id = await draft(writer);
    await writer.client.rpc("submit_claim", { p_claim: id, p_version: await version(id) });
    const v = await version(id);
    const args = { p_claim: id, p_decision: "approve" as const, p_reason: "", p_version: v, p_client: {} };
    const [a, b] = await Promise.all([head.client.rpc("act_on_claim", args), head2.client.rpc("act_on_claim", args)]);
    const ok = [a, b].filter((r) => !r.error).length;
    expect(ok).toBe(1);
    const { data } = await admin.from("approval_steps").select("decision").eq("claim_id", id).not("decision", "is", null);
    expect(data).toHaveLength(1);
  });

  it("does not let a receipt removal race with submit", async () => {
    const id = await draft(writer);
    const { data: att } = await admin.from("attachments").select("id").eq("claim_id", id).single();
    const v = await version(id);
    const [submit, remove] = await Promise.all([
      writer.client.rpc("submit_claim", { p_claim: id, p_version: v }),
      writer.client.rpc("remove_attachment", { p_attachment: att!.id }),
    ]);
    const { data: claim } = await admin.from("claims").select("status").eq("id", id).single();
    const { count } = await admin.from("attachments").select("id", { count: "exact", head: true }).eq("claim_id", id);
    // Either the submit won (claim in review with its receipt) or the removal won (draft without receipt).
    if (!submit.error) {
      expect(claim!.status).toBe("in_review");
      expect(count).toBe(1);
      expect(remove.error).not.toBeNull();
    } else {
      expect(claim!.status).toBe("draft");
    }
  });
});
