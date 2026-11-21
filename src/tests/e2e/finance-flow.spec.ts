import { expect, test } from "@playwright/test";
import { jpegBytes, signIn } from "./helpers";

// M3 completion check: an approved claim is verified by finance, paid by check,
// shows as issued to the writer and appears in the monthly CSV.
test("finance verifies, records a check and exports CSV", async ({ browser }) => {
  const writerCtx = await browser.newContext();
  const writer = await writerCtx.newPage();
  await signIn(writer, "writer@church.test", "/claims/new");
  await writer.locator("#new-department").selectOption({ label: "유년부 · Children" });
  await writer.getByRole("button", { name: /시작하기/ }).click();
  await writer.waitForURL(/\/claims\/[0-9a-f-]{36}$/);
  const claimPath = new URL(writer.url()).pathname;
  await writer.locator("#draft-purpose").fill("E2E 재정 흐름");
  await writer.locator("#draft-date").fill("2026-11-20");
  await writer.locator("#line-desc-0").fill("교재");
  await writer.locator("#line-amount-0").fill("50.25");
  await writer.locator("#receipt-file").setInputFiles({ name: "r.jpg", mimeType: "image/jpeg", buffer: jpegBytes("fin") });
  await expect(writer.locator(".thumbs a")).toHaveCount(1);
  await writer.locator("#submit-claim").click();
  await expect(writer.getByText("결재 중")).toBeVisible();
  const claimNo = (await writer.locator("strong").first().textContent())?.trim() ?? "";

  for (const email of ["head@church.test", "elder@church.test"]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signIn(page, email, claimPath);
    await page.getByRole("button", { name: /^승인/ }).click();
    await page.getByRole("button", { name: /^승인하기/ }).click();
    await expect(page.getByText("승인하셨습니다")).toBeVisible();
    await ctx.close();
  }

  // Finance verifies on the claim page, then records the check on /finance.
  const finCtx = await browser.newContext();
  const fin = await finCtx.newPage();
  await signIn(fin, "finance@church.test", claimPath);
  await fin.getByRole("button", { name: /서류 확인 완료/ }).click();
  await expect(fin.getByText("수표 준비됨")).toBeVisible();

  await fin.goto("/finance");
  const row = fin.locator("li", { hasText: claimNo });
  await row.locator('input[type="checkbox"]').check();
  const checkNo = String(Date.now()).slice(-6);
  await fin.locator("#check-no").fill(checkNo);
  // The typed check amount must match the selected claims.
  await fin.locator("#check-amount").fill("50.00");
  await fin.getByRole("button", { name: /수표 기록/ }).click();
  await expect(fin.getByText(/합계와 다릅니다/)).toBeVisible();
  await fin.locator("#check-amount").fill("50.25");
  await fin.getByRole("button", { name: /수표 기록/ }).click();
  await expect(fin.getByText(/수표를 기록했습니다/)).toBeVisible();
  const checkRow = fin.locator("li", { hasText: `#${checkNo}` });
  await expect(checkRow).toBeVisible();
  // The person who recorded the check does not record its clearing (D21).
  await expect(checkRow.getByRole("button", { name: "결제됨 기록" })).toHaveCount(0);

  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit" })
    .format(new Date())
    .slice(0, 7);
  const csv = await fin.request.get(`/api/finance/export?month=${month}`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-disposition"]).toContain("attachment");
  const text = await csv.text();
  expect(text).toContain(claimNo);
  expect(text).toContain("50.25");

  await writer.reload();
  await expect(writer.getByText("수표 발행됨")).toBeVisible();

  // A wrong check is voided with a reason; the claim goes back to "to pay".
  await checkRow.getByRole("button", { name: "무효 처리" }).click();
  await fin.locator(`[id^="row-void-"]`).fill("수표 금액 오기재");
  await fin.getByRole("button", { name: /^무효 처리$/ }).last().click();
  await expect(fin.getByText(/무효 처리했습니다/)).toBeVisible();
  await expect(fin.locator("li", { hasText: claimNo }).locator('input[type="checkbox"]')).toBeVisible();

  // The writer cannot download the finance CSV.
  const denied = await writer.request.get(`/api/finance/export?month=${month}`);
  expect(denied.status()).toBe(403);

  await Promise.all([writerCtx.close(), finCtx.close()]);
});

test("daily cron requires the secret", async ({ request }) => {
  expect((await request.get("/api/cron/daily")).status()).toBe(401);
  const ok = await request.get("/api/cron/daily", { headers: { authorization: "Bearer local-cron-secret" } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toHaveProperty("retried");
});
