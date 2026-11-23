// Centralized access to public environment variables. Server-only secrets live
// in src/lib/server/env.ts so they can never be bundled for the browser.

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable ${name}. See doc/setup.md.`);
  }
  return value;
}

export const publicEnv = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabasePublishableKey() {
    return required(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
  },
  /** Where server code reaches Supabase. On the Mac mini this is the local
   *  gateway (SUPABASE_INTERNAL_URL=http://127.0.0.1:8000), so server calls and
   *  the service key never leave the machine. Browsers always use supabaseUrl. */
  get supabaseServerUrl() {
    return process.env.SUPABASE_INTERNAL_URL || this.supabaseUrl;
  },
  get kakaoJsKey() {
    return process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? "";
  },
};

/** Session cookie name, fixed to the public API host. @supabase/ssr derives
 *  the name from the URL it is given, so without this the browser (public URL)
 *  and the server (internal URL) would look for different cookies. */
export function authCookieName(): string {
  const host = new URL(publicEnv.supabaseUrl).hostname;
  return `sb-${host.split(".")[0]}-auth-token`;
}
