const { test, expect } = require("@playwright/test");

test("dialog and drawer are keyboard accessible", async ({ page }) => {
  await page.goto("/component-preview.html");
  await page.getByRole("button", { name: "Open dialog" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByRole("button", { name: "Open drawer" }).click();
  await expect(page.getByRole("complementary", { name: "Component drawer" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "Component drawer" })).toBeHidden();
});

test("responsive component preview has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/component-preview.html");
  await expect(page.locator("body")).toEvaluate((body) => body.scrollWidth <= window.innerWidth);
  await expect(page.getByText("No active experiments")).toBeVisible();
});
