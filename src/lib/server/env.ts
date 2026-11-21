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
  get cronSecret() {
    return required("CRON_SECRET");
  },
  get mailFrom() {
    return process.env.MAIL_FROM ?? "Church Intranet <no-reply@example.org>";
  },
  get resendApiKey() {
    // When empty, emails are written to the server log instead of being sent.
    return process.env.RESEND_API_KEY ?? "";
  },
};
