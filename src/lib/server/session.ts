import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Me =
  | { signed_in: false }
  | { signed_in: true; linked: false }
  | {
      signed_in: true;
      linked: true;
      person_id: string;
      name: string;
      status: "invited" | "pending" | "active" | "suspended";
      lang: "ko" | "en";
      email: string | null;
      mail_address: string | null;
      legal_name_en: string | null;
      is_admin: boolean;
      is_auditor: boolean;
      is_finance: boolean;
      departments: { id: string; name: string }[];
    };

/** Who is signed in and what they may do, computed by the database (public.me()). */
export async function getMe(): Promise<{ me: Me; supabase: Awaited<ReturnType<typeof createClient>> }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("me");
  if (error || !data) return { me: { signed_in: false }, supabase };
  return { me: data as unknown as Me, supabase };
}

export type ActiveMe = Extract<Me, { linked: true }>;

export function isActive(me: Me): me is ActiveMe {
  return me.signed_in && me.linked && me.status === "active";
}
