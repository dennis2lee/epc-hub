// A Vercel preview (or development) deployment must never talk to the
// production database: it runs unreviewed code and would send real mail.
// SUPABASE_PROD_REF is the production project ref (not a secret). On Vercel
// non-production deployments it must be set, so a missing value fails closed.
// Local runs (no VERCEL_ENV) are exempt.

export function assertNotProdFromPreview(supabaseUrl: string | undefined): void {
  const vercelEnv = process.env.VERCEL_ENV;
  if (!vercelEnv || vercelEnv === "production") return;
  const prodRef = process.env.SUPABASE_PROD_REF;
  if (!prodRef) throw new Error("SUPABASE_PROD_REF must be set on Vercel preview deployments (doc/deploy.md)");
  if ((supabaseUrl ?? "").includes(prodRef)) {
    throw new Error("Preview deployment points at the production Supabase project; refusing to run");
  }
}
