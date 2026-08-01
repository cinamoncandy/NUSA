const { _electron: electron } = require("@playwright/test");
const fs = require("node:fs");

(async () => {
  const root = "docs/artifacts/a4p-v2";
  fs.mkdirSync(root, { recursive: true });
  for (const name of ["dashboard", "market", "shadow-session", "orders", "portfolio", "risk", "recovery", "evidence", "diagnostics", "settings", "about"]) {
    const app = await electron.launch({ executablePath: require("electron"), args: ["apps/desktop", "--disable-gpu"], env: { ...process.env, ELECTRON_IS_DEV: "0" } });
    const page = await app.firstWindow();
    app.process().stderr.on("data", (chunk) => process.stderr.write(String(chunk)));
    await page.waitForTimeout(700);
    if (name !== "dashboard") await page.evaluate((screen) => window.NUSABrandUI.activate(screen), name);
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${root}/${name}.png`, fullPage: true });
    if (name === "dashboard") {
      for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080]]) {
        await page.setViewportSize({ width, height });
        await page.screenshot({ path: `${root}/dashboard-${width}x${height}.png`, fullPage: true });
      }
    }
    console.log(`${name}=${await page.locator(".workspace-view.is-active .workspace-view__title").textContent()} captured`);
    await app.close();
  }
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
