const { _electron: electron } = require("@playwright/test");

(async () => {
  const app = await electron.launch({ executablePath: require("electron"), args: ["apps/desktop", "--disable-gpu"], env: { ...process.env, ELECTRON_IS_DEV: "0" } });
  const page = await app.firstWindow();
  await page.waitForTimeout(600);
  await page.evaluate(() => window.DokkaebiBrandUI.activate("evidence"));
  await page.waitForTimeout(100);
  await page.screenshot({ path: "docs/artifacts/a4p-v2/evidence.png", fullPage: true });
  console.log(await page.locator(".workspace-view.is-active .workspace-view__title").textContent());
  await app.close();
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
