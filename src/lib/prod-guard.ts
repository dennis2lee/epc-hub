// Only the church Mac mini (APP_ENV=production) may talk to the production
// Supabase API (D46). A development or test run that points at it would run
// unreviewed code against member data and send real mail. The production host
// is not a secret; PROD_SUPABASE_HOST overrides the default.

const DEFAULT_PROD_HOST = "api.epcsj-hub.org";

export function assertNotProdFromPreview(supabaseUrl: string | undefined): void {
  if (process.env.APP_ENV === "production") return;
  const prodHost = process.env.PROD_SUPABASE_HOST || DEFAULT_PROD_HOST;
  let host = "";
  try {
    host = new URL(supabaseUrl ?? "").hostname;
  } catch {
    return;
  }
  if (host === prodHost) {
    throw new Error("This is not the production server (APP_ENV) but it points at the production Supabase API; refusing to run");
  }
}
