import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Admin screen: register a person, make an invite, assign and end a position,
// and suspend (with a confirmation sheet) and reactivate. Uses fresh names so
// the seed people used by the other tests are untouched.
test("admin registers, assigns, ends a position, suspends and reactivates", async ({ page }) => {
  const tag = String(Date.now()).slice(-6);
  const deptName = `E2E부서${tag}`;
  const personName = `E2E교인${tag}`;
  const phone = `(213) 7${tag.slice(0, 2)}-${tag.slice(2, 6)}`;

  await signIn(page, "admin@church.test", "/admin");

  await page.locator("#dept-name").fill(deptName);
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await expect(page.locator("li", { hasText: deptName })).toBeVisible();

  await page.locator("#person-name").fill(personName);
  await page.locator("#person-legal").fill("E2E Member");
  await page.locator("#person-phone").fill(phone);
  await page.getByRole("button", { name: "등록", exact: true }).click();
  const row = page.locator("li", { hasText: personName }).filter({ hasText: "휴대폰 끝" });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`휴대폰 끝 ${tag.slice(2, 6)}`);

  await row.getByRole("button", { name: "초대 링크 만들기" }).click();
  await expect(page.getByText(`${personName}님 초대 링크`)).toBeVisible();
  await expect(page.locator("code", { hasText: "/invite/" })).toBeVisible();

  // Assign a department head in the new department, then end it.
  await page.locator("#pos-person").selectOption({ label: personName });
  await page.locator("#pos-dept").selectOption({ label: deptName });
  await page.locator("#pos-role").selectOption({ label: "부장" });
  await page.getByRole("button", { name: "배정", exact: true }).click();
  const position = page.locator("li", { hasText: `${deptName} · 부장` });
  await expect(position).toBeVisible();
  await position.getByRole("button", { name: "직책 끝내기" }).click();
  await position.getByRole("button", { name: "직책 끝내기" }).click();
  await expect(position).toContainText("까지");

  // Suspend needs a confirmation; then lift it.
  await row.getByRole("button", { name: /정지/ }).click();
  await expect(page.getByRole("alertdialog")).toContainText(`${personName}님을 정지합니다`);
  await page.getByRole("alertdialog").getByRole("button", { name: /^정지/ }).click();
  await expect(row).toContainText("정지");
  await row.getByRole("button", { name: "정지 풀기" }).click();
  await expect(row).toContainText("초대 전");
});
