"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client (used for email-code sign-in and Kakao option 1). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
