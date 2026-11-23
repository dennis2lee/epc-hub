import fs from "node:fs";
import { expect, it } from "vitest";

// The self-hosted Auth server fetches the login-code template from the app
// (public/auth-templates); the local CLI stack reads src/supabase/templates.
it("serves the same login-code email template the local stack uses", () => {
  const served = fs.readFileSync("public/auth-templates/otp.html", "utf8");
  const local = fs.readFileSync("src/supabase/templates/otp.html", "utf8");
  expect(served).toBe(local);
  expect(served).toContain("{{ .Token }}");
});
