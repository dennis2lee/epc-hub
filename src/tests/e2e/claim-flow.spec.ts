import { expect, test } from "@playwright/test";
import { jpegBytes, signIn } from "./helpers";

// M2 completion check: a writer drafts and submits a claim on a phone-sized
// screen, the department head and the elder approve it, and it reaches finance.
test("write, submit and approve a claim", async ({ browser }) => {
  // --- writer
  const writerCtx = await browser.newContext();
  const writer = await writerCtx.newPage();
  await signIn(writer, "writer@church.test", "/claims/new");

  await writer.locator("#new-department").selectOption({ label: "유년부 · Children" });
  await writer.getByRole("button", { name: /시작하기/ }).click();
  await writer.waitForURL(/\/claims\/[0-9a-f-]{36}$/);
  const claimUrl = writer.url();

  await writer.locator("#draft-purpose").fill("E2E 성탄 행사 간식");
  await writer.locator("#draft-date").fill("2026-11-18");
  await writer.locator("#line-desc-0").fill("간식");
  await writer.locator("#line-amount-0").fill("128.40");
  await expect(writer.locator("#draft-total")).toHaveText("$128.40");

  // Picking a photo uploads it at once; unsaved fields stay on screen.
  await writer.locator("#receipt-file").setInputFiles({
    name: "receipt.jpg",
    mimeType: "image/jpeg",
    buffer: jpegBytes("e2e"),
  });
  await expect(writer.locator(".thumbs a")).toHaveCount(1);
  await expect(writer.locator("#draft-purpose")).toHaveValue("E2E 성탄 행사 간식");

  await expect(writer.getByText(/부장 박부장 → 담당 장로 이장로/)).toBeVisible();
  // One button saves what is on screen and submits it.
  await writer.locator("#submit-claim").click();
  await expect(writer.getByText("결재 중")).toBeVisible();
  await expect(writer.locator(".amount")).toHaveText("$128.40");
  await expect(writer.getByText(/지금 박부장님 차례입니다/)).toBeVisible();

  // --- department head approves with the confirmation sheet
  const headCtx = await browser.newContext();
  const head = await headCtx.newPage();
  await signIn(head, "head@church.test", new URL(claimUrl).pathname);
  await head.getByRole("button", { name: /^승인/ }).click();
  await expect(head.getByText(/\$128\.40 · .+ 앞 수표 · 영수증 1장을 승인합니다/)).toBeVisible();
  await head.getByRole("button", { name: /^승인하기/ }).click();
  // The result stays on screen, rendered from the server, with who was told next.
  await expect(head.getByText("승인하셨습니다")).toBeVisible();
  await expect(head.getByText(/이장로님께 메일로 알렸습니다/)).toBeVisible();

  // --- elder approves; the claim goes to finance
  const elderCtx = await browser.newContext();
  const elder = await elderCtx.newPage();
  await signIn(elder, "elder@church.test", new URL(claimUrl).pathname);
  await elder.getByRole("button", { name: /^승인/ }).click();
  await elder.getByRole("button", { name: /^승인하기/ }).click();
  await expect(elder.getByText("승인하셨습니다")).toBeVisible();
  await expect(elder.getByText(/재정부께 메일로 알렸습니다/)).toBeVisible();

  await writer.reload();
  await expect(writer.getByText("재정부 확인 대기")).toBeVisible();

  await Promise.all([writerCtx.close(), headCtx.close(), elderCtx.close()]);
});

test("request changes needs a reason and returns the claim to the writer", async ({ browser }) => {
  const writerCtx = await browser.newContext();
  const writer = await writerCtx.newPage();
  await signIn(writer, "writer@church.test", "/claims/new");
  await writer.locator("#new-department").selectOption({ label: "유년부 · Children" });
  await writer.getByRole("button", { name: /시작하기/ }).click();
  await writer.waitForURL(/\/claims\/[0-9a-f-]{36}$/);
  const claimPath = new URL(writer.url()).pathname;
  await writer.locator("#draft-purpose").fill("E2E 교재");
  await writer.locator("#draft-date").fill("2026-11-19");
  await writer.locator("#line-desc-0").fill("교재");
  await writer.locator("#line-amount-0").fill("45");
  await writer.getByRole("button", { name: /임시 저장/ }).click();
  await expect(writer.getByText("저장했습니다.")).toBeVisible();
  await writer.locator("#receipt-file").setInputFiles({ name: "r.jpg", mimeType: "image/jpeg", buffer: jpegBytes("rej") });
  await expect(writer.locator(".thumbs a")).toHaveCount(1);
  // An edit after saving is what gets submitted (M2 review: no stale submit).
  await writer.locator("#line-amount-0").fill("450");
  await writer.locator("#submit-claim").click();
  await expect(writer.getByText("결재 중")).toBeVisible();
  await expect(writer.locator(".amount")).toHaveText("$450.00");

  const headCtx = await browser.newContext();
  const head = await headCtx.newPage();
  await signIn(head, "head@church.test", claimPath);
  await head.getByRole("button", { name: /^보완 요청/ }).click();
  await head.getByRole("button", { name: /^보완 요청 보내기/ }).click();
  await expect(head.getByText("사유를 골라 주세요.")).toBeVisible();
  await head.getByRole("button", { name: "영수증 누락" }).click();
  await head.getByRole("button", { name: /^보완 요청 보내기/ }).click();
  await expect(head.getByText("보완을 요청하셨습니다")).toBeVisible();
  await expect(head.getByText(/작성자 김작성님께 메일로 알렸습니다/)).toBeVisible();

  await writer.reload();
  await expect(writer.getByText("보완 요청 받음")).toBeVisible();
  await expect(writer.getByText(/보완 요청 \(박부장\): 영수증 누락/)).toBeVisible();
  await writer.getByRole("button", { name: /고쳐서 다시 올리기/ }).click();
  await expect(writer.getByText("작성 중")).toBeVisible();

  await Promise.all([writerCtx.close(), headCtx.close()]);
});
