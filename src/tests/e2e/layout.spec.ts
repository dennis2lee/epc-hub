import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// No screen may scroll sideways on a narrow phone. A page wider than the screen
// makes phones zoom out and puts taps on the wrong element.
test.use({ viewport: { width: 360, height: 740 } });

async function overflowing(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > w) out.push(`page scrollWidth ${document.documentElement.scrollWidth} > ${w}`);
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.right > w + 1) {
        const cls = (el as HTMLElement).className;
        out.push(`${el.tagName.toLowerCase()}${typeof cls === "string" && cls ? "." + cls.split(" ").join(".") : ""} right=${Math.round(b.right)} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
      }
    }
    return out.slice(0, 15);
  });
}

test("main screens fit a 360px-wide phone", async ({ page, browser }) => {
  await signIn(page, "admin@church.test", "/admin");
  expect(await overflowing(page), "/admin").toEqual([]);

  await page.goto("/");
  expect(await overflowing(page), "/").toEqual([]);

  await page.goto("/claims/new");
  await page.getByRole("button", { name: /시작하기/ }).click();
  await page.waitForURL(/\/claims\/[0-9a-f-]{36}$/);
  expect(await overflowing(page), "draft").toEqual([]);
  // The confirmation sheet must fit too (taps land on the wrong element otherwise).
  await page.getByRole("button", { name: /이 청구서 지우기/ }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  expect(await overflowing(page), "draft + delete sheet").toEqual([]);
  await page.getByRole("alertdialog").getByRole("button", { name: /^지우기/ }).click();
  await page.waitForURL((u) => u.pathname === "/");

  const finCtx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const fin = await finCtx.newPage();
  await signIn(fin, "finance@church.test", "/finance");
  expect(await overflowing(fin), "/finance").toEqual([]);
  await finCtx.close();
});
