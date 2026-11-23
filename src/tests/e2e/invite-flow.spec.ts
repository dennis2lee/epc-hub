import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Invite links: the token moves into a cookie, a new email login is created
// only for a browser holding a live invite, and the office can re-link a login.
test("invite link links a new member; relink sends them back to invited", async ({ page, browser }) => {
  const tag = String(Date.now()).slice(-6);
  const name = `초대${tag}`;
  const email = `invitee${tag}@church.test`;
  const last4 = tag.slice(2, 6);

  await signIn(page, "admin@church.test", "/admin");
  await page.locator("#person-name").fill(name);
  await page.locator("#person-phone").fill(`(213) 8${tag.slice(0, 2)}-${last4}`);
  await page.getByRole("button", { name: "등록", exact: true }).click();
  const row = page.locator("li", { hasText: name }).filter({ hasText: "휴대폰 끝" });
  await row.getByRole("button", { name: "초대 링크 만들기" }).click();
  const url = (await page.locator("code", { hasText: "/invite/" }).textContent())!.trim();

  // Without an invite, an unknown address gets a neutral answer and no account.
  const stranger = await browser.newContext();
  const sp = await stranger.newPage();
  await sp.goto("/login");
  await sp.locator("#login-email").fill(`nobody${tag}@church.test`);
  await sp.getByRole("button", { name: /코드 받기/ }).click();
  await expect(sp.getByText("등록된 주소라면")).toBeVisible();
  await stranger.close();

  // The member opens the link in their own browser.
  const member = await browser.newContext();
  const mp = await member.newPage();
  await mp.goto(new URL(url).pathname);
  await expect(mp).toHaveURL(/\/invite$/);
  await expect(mp.getByRole("link", { name: /로그인하고 계속하기/ })).toHaveAttribute("href", "/login?next=%2Finvite");
  await signIn(mp, email, "/invite");
  await expect(mp.getByText(`${name}님 본인이 맞습니까?`)).toBeVisible();
  await mp.locator("#invite-last4").fill(last4);
  await mp.getByRole("button", { name: /네, 본인입니다/ }).click();
  await mp.waitForURL((u) => u.pathname === "/");
  await member.close();

  // The office sees how they sign in, then re-links them.
  await page.reload();
  const linked = page.locator("li", { hasText: name }).filter({ hasText: "휴대폰 끝" });
  await expect(linked).toContainText("로그인: 메일 코드");
  await expect(linked).toContainText("사용 중");
  // Linking by email code filled in the address the office left blank.
  await expect(linked).not.toContainText("메일 없음");
  await linked.getByRole("button", { name: "로그인 다시 연결" }).click();
  await page.locator(`[id^="relink-reason-"]`).fill("다른 방법으로 로그인하심");
  await page.getByRole("button", { name: "연결 지우기" }).click();
  await expect(linked).toContainText("초대 전");
  await expect(linked.getByRole("button", { name: "초대 링크 만들기" })).toBeVisible();
});
