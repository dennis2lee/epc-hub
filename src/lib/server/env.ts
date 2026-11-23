import "server-only";

// Server-only secrets. Importing this file from a Client Component fails the build.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See doc/setup.md.`);
  return value;
}

export const serverEnv = {
  get supabaseSecretKey() {
    return required("SUPABASE_SECRET_KEY");
  },
  get kakaoRestApiKey() {
    return required("KAKAO_REST_API_KEY");
  },
  get kakaoClientSecret() {
    // Optional: only needed when "Client Secret" is enabled in the Kakao console.
    return process.env.KAKAO_CLIENT_SECRET ?? "";
  },
  /** Canonical public origin (e.g. https://claims.example.org). Used for OAuth
   *  redirect URIs instead of the request Host header. */
  get appOrigin() {
    const v = process.env.NEXT_PUBLIC_SITE_URL;
    if (!v && process.env.NODE_ENV === "production") throw new Error("Missing NEXT_PUBLIC_SITE_URL");
    return (v ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get cronSecret() {
    return required("CRON_SECRET");
  },
  get mailFrom() {
    // In production an unset sender would make every message fail at the
    // provider (unverified domain), so it is a configuration error.
    const v = process.env.MAIL_FROM ?? "";
    if (!v && process.env.NODE_ENV === "production") throw new Error("Missing MAIL_FROM");
    return v || "Church Intranet <no-reply@example.org>";
  },
  get resendApiKey() {
    // When empty, emails are written to the server log instead of being sent.
    // In production a missing key is a configuration error (names and amounts
    // must not end up in hosting logs).
    const v = process.env.RESEND_API_KEY ?? "";
    if (!v && process.env.NODE_ENV === "production") throw new Error("Missing RESEND_API_KEY");
    return v;
  },
};
