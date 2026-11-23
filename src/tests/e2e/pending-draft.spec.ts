import { expect, test } from "@playwright/test";
import { jpegBytes, signIn } from "./helpers";

// An approver-to-be links their phone and waits for the office's in-person
// check. Meanwhile they can write and save a claim with a receipt, but not
// submit it until the office confirms them.
test("a pending account keeps drafts and submits only after the office check", async ({ page, browser }) => {
  const tag = String(Date.now()).slice(-6);
  const name = `대기${tag}`;
  const email = `pending${tag}@church.test`;
  const last4 = tag.slice(2, 6);

  await signIn(page, "admin@church.test", "/admin");
  await page.locator("#person-name").fill(name);
  await page.locator("#person-phone").fill(`(213) 7${tag.slice(0, 2)}-${last4}`);
  await page.locator('input[name="approver"]').check();
  await page.getByRole("button", { name: "등록", exact: true }).click();
  const row = page.locator("li", { hasText: name }).filter({ hasText: "휴대폰 끝" });
  await row.getByRole("button", { name: "초대 링크 만들기" }).click();
  const url = (await page.locator("code", { hasText: "/invite/" }).textContent())!.trim();

  const member = await browser.newContext();
  const mp = await member.newPage();
  await mp.goto(new URL(url).pathname);
  await signIn(mp, email, "/invite");
  await mp.locator("#invite-last4").fill(last4);
  await mp.getByRole("button", { name: /네, 본인입니다/ }).click();
  await mp.waitForURL((u) => u.pathname === "/");

  // Home: the waiting notice, and a way to start a claim.
  await expect(mp.getByText("사무실 확인 중")).toBeVisible();
  await mp.getByRole("link", { name: /새 지출청구서 쓰기/ }).click();
  await mp.locator("#new-department").selectOption({ label: "유년부 · Children" });
  await mp.getByRole("button", { name: /시작하기/ }).click();
  await mp.waitForURL(/\/claims\/[0-9a-f-]{36}$/);
  const claimPath = new URL(mp.url()).pathname;

  await mp.locator("#draft-purpose").fill("대기 중 임시저장");
  await mp.locator("#draft-date").fill("2026-11-18");
  await mp.locator("#line-desc-0").fill("간식");
  await mp.locator("#line-amount-0").fill("12.00");
  await mp.getByRole("button", { name: /임시 저장/ }).click();
  await expect(mp.getByText("저장했습니다.")).toBeVisible();
  await mp.locator("#receipt-file").setInputFiles({ name: "r.jpg", mimeType: "image/jpeg", buffer: jpegBytes(`p${tag}`) });
  await expect(mp.locator(".thumbs a")).toHaveCount(1);
  const receipt = await mp.request.get((await mp.locator(".thumbs a").first().getAttribute("href"))!, { maxRedirects: 0 });
  expect(receipt.status()).toBe(302);

  await expect(mp.getByText(/사무실에서 계정을 확인하면 결재를 올릴 수 있습니다/)).toBeVisible();
  await expect(mp.locator("#submit-claim")).toBeDisabled();

  // The draft is listed on the home screen after a reload.
  await mp.goto("/");
  await expect(mp.getByRole("link", { name: /대기 중 임시저장/ })).toBeVisible();

  // After the office's in-person check the approval line appears.
  await page.reload();
  const pendingRow = page.locator("li", { hasText: name }).filter({ hasText: "휴대폰 끝" });
  await pendingRow.getByRole("button", { name: /대면 확인 완료/ }).click();
  await expect(pendingRow).toContainText("사용 중");
  await mp.goto(claimPath);
  await expect(mp.getByText(/사무실에서 계정을 확인하면/)).toHaveCount(0);
  await expect(mp.getByText(/결재 순서/)).toBeVisible();
  await member.close();
});
