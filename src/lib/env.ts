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
  get kakaoJsKey() {
    return process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? "";
  },
};
