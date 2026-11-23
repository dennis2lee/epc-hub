import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { authCookieName, publicEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";

/**
 * Supabase client bound to the current user's session cookies.
 * All database access from pages and Server Actions must use this client so that
 * RLS and the SQL functions see the real user.
 */
export async function createClient() {
  // Everything that touches the user's data renders at request time, never
  // during prerendering (Cache Components).
  await connection();
  const cookieStore = await cookies();
  return createServerClient<Database>(publicEnv.supabaseServerUrl, publicEnv.supabasePublishableKey, {
    cookieOptions: { name: authCookieName() },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component where cookies are read-only.
          // The proxy refreshes the session on the next request.
        }
      },
    },
  });
}
