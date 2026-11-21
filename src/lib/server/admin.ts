import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/server/env";
import type { Database } from "@/lib/database.types";

/**
 * Service-role client. It bypasses RLS, so it is allowed ONLY for the explicit
 * exceptions listed in doc/decisions.md (D4: notification delivery). Never use
 * it to read or change claims on behalf of a user.
 */
export function createServiceClient() {
  return createSupabaseClient<Database>(publicEnv.supabaseUrl, serverEnv.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
