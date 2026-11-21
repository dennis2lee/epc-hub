// Integration test: storage policies as a real signed-in user (local stack required).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { loadLocalEnv } from "./env";

const env = loadLocalEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;

async function signIn(email: string): Promise<{ client: SupabaseClient; uid: string }> {
  const admin = createClient(url, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const client = createClient(url, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { data, error: e2 } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (e2 || !data.user) throw e2 ?? new Error("no user");
  return { client, uid: data.user.id };
}

describe("storage policies", () => {
  let writer: { client: SupabaseClient; uid: string };
  const name = `check-${Date.now()}.txt`;

  beforeAll(async () => {
    writer = await signIn("writer@church.test");
  });

  it("allows uploads to the user's own trial folder", async () => {
    const r = await writer.client.storage.from("trial").upload(`${writer.uid}/${name}`, new Blob(["hello"]));
    expect(r.error).toBeNull();
  });

  it("blocks uploads to another user's folder", async () => {
    const r = await writer.client.storage.from("trial").upload(`someone-else/${name}`, new Blob(["x"]));
    expect(r.error).not.toBeNull();
  });

  it("blocks overwriting an existing file", async () => {
    const r = await writer.client.storage
      .from("trial")
      .upload(`${writer.uid}/${name}`, new Blob(["overwrite"]), { upsert: true });
    expect(r.error).not.toBeNull();
  });

  it("blocks receipt uploads for a claim the user cannot edit", async () => {
    const r = await writer.client.storage
      .from("receipts")
      .upload("00000000-0000-0000-0000-000000000000/x.jpg", new Blob(["x"], { type: "image/jpeg" }), { contentType: "image/jpeg" });
    expect(r.error).not.toBeNull();
  });

  it("allows receipt uploads for the user's own draft", async () => {
    const { data: claimId, error } = await writer.client.rpc("create_claim", {
      p_department: "10000000-0000-0000-0000-000000000002",
    });
    expect(error).toBeNull();
    const r = await writer.client.storage
      .from("receipts")
      .upload(`${claimId}/r.jpg`, new Blob(["jpeg"], { type: "image/jpeg" }), { contentType: "image/jpeg" });
    expect(r.error).toBeNull();
  });
});
