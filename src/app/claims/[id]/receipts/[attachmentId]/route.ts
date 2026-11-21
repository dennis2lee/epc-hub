import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Receipt viewer: signs a fresh, short URL on every request with the user's own
// session (storage policies apply), so pages never embed URLs that expire while
// an approver is still looking at the claim.
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string; attachmentId: string }> }) {
  const { id, attachmentId } = await ctx.params;
  const supabase = await createClient();
  const { data: att } = await supabase
    .from("attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .eq("claim_id", id)
    .maybeSingle();
  if (!att) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await supabase.storage.from("receipts").createSignedUrl(att.storage_path, 60);
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "Cache-Control": "private, no-store" } });
}
