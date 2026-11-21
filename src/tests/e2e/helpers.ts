import { expect, type Page } from "@playwright/test";

const MAILPIT = "http://127.0.0.1:54324";

type MailpitMessage = { ID: string; Created: string; Snippet: string };

/** Wait for a sign-in code email to `email` that is newer than `since`. */
async function waitForCode(email: string, since: number): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const data = (await res.json()) as { messages?: MailpitMessage[] };
    const fresh = (data.messages ?? []).filter((m) => Date.parse(m.Created) >= since - 1000);
    for (const m of fresh) {
      const code = /\b(\d{6})\b/.exec(m.Snippet)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no sign-in code for ${email}`);
}

/** Sign in with the email-code flow, landing on `next`. */
export async function signIn(page: Page, email: string, next = "/") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  const since = Date.now();
  await page.locator("#login-email").fill(email);
  await page.getByRole("button", { name: /코드 받기/ }).click();
  await expect(page.locator("#login-code")).toBeVisible();
  const code = await waitForCode(email, since);
  await page.locator("#login-code").fill(code);
  await page.getByRole("button", { name: /^확인/ }).click();
  await page.waitForURL((url) => url.pathname === next.split("?")[0], { timeout: 15_000 });
}

/** A tiny but valid JPEG header plus unique bytes, so each upload has its own hash. */
export function jpegBytes(label: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`receipt ${label} ${Date.now()}`)]);
}
