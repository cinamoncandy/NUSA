const { test, expect } = require("@playwright/test");

async function installRendererBridge(page) {
  await page.addInitScript(() => {
    const listeners = {};
    const snapshot = {
      equity: 1000000,
      cash: 1000000,
      unrealizedPnl: 0,
      position: { market: "KRW-BTC", quantity: 0, averagePrice: 0, realizedPnl: 0 },
      orders: []
    };
    window.nusa = {
      getSnapshot: async () => snapshot,
      getControlSnapshot: async () => ({ status: "STOPPED", autoTradeEnabled: false, events: [] }),
      getA4Diagnostics: async () => ({}),
      onStatus: (handler) => { listeners.status = handler; handler("connected"); return () => { delete listeners.status; }; },
      onTicker: (handler) => { listeners.ticker = handler; handler({ trade_price: 90000000, signed_change_rate: 0 }); return () => { delete listeners.ticker; }; },
      onSnapshot: (handler) => { listeners.snapshot = handler; handler(snapshot); return () => { delete listeners.snapshot; }; },
      onControl: (handler) => { listeners.control = handler; handler({ status: "STOPPED", autoTradeEnabled: false, events: [] }); return () => { delete listeners.control; }; },
      onChartPoint: (handler) => { listeners.chartPoint = handler; return () => { delete listeners.chartPoint; }; },
      placeOrder: async () => ({ snapshot }),
      startStrategy: async () => ({ status: "RUNNING", autoTradeEnabled: false, events: [] }),
      stopStrategy: async () => ({ status: "STOPPED", autoTradeEnabled: false, events: [] }),
      setAutoTrade: async () => ({ status: "STOPPED", autoTradeEnabled: false, events: [] }),
      setStrategyQuantity: async () => ({ status: "STOPPED", autoTradeEnabled: false, events: [] })
    };
    window.nusaApp = {
      settings: async () => ({ settings: { theme: "dark", logLevel: "info", showDiagnostics: true, showNotifications: true } }),
      about: async () => ({ about: { appVersion: "0.1.0", electronVersion: "test", nodeVersion: "test", mode: "Paper Trading" } }),
      saveSettings: async () => ({}),
      resetSettings: async () => ({}),
      firstRun: async () => ({ notice: null })
    };
  });
}

test("canonical renderer keeps Paper state, navigation, and order confirmation usable on mobile", async ({ page }) => {
  await installRendererBridge(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/index.html");
  await expect(page.getByTestId("nusa-app-root")).toBeVisible();
  await expect(page.getByText("PAPER · 실거래 비활성")).toBeVisible();
  await expect(page.locator(".v2-nav [data-simple-nav]")).toHaveCount(5);
  expect(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(true);

  const sidebar = page.locator(".v2-sidebar");
  await expect(sidebar).toBeVisible();
  expect(await sidebar.evaluate((node) => getComputedStyle(node).position)).toBe("fixed");

  await page.locator(".v2-nav [data-simple-nav='orders']").click();
  await expect(page.locator("[data-simple-page='orders']")).toBeVisible();
  const buy = page.locator("[data-simple-order='BUY']");
  await expect(buy).toBeEnabled();
  await buy.click();
  await expect(page.getByRole("dialog", { name: "Paper 주문 확인" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Paper 주문 확인" })).toContainText("Paper 주문 확인");
});

test("canonical renderer uses bottom-fixed navigation on mobile and compact rail on tablet", async ({ page }) => {
  await installRendererBridge(page);
  await page.goto("/index.html");

  await page.setViewportSize({ width: 390, height: 844 });
  const sidebar = page.locator(".v2-sidebar");
  await expect(sidebar).toBeVisible();
  expect(await sidebar.evaluate((node) => getComputedStyle(node).position)).toBe("fixed");
  expect(await sidebar.evaluate((node) => getComputedStyle(node).bottom)).toBe("0px");

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(sidebar).toBeVisible();
  expect(await sidebar.evaluate((node) => getComputedStyle(node).position)).toBe("sticky");
  const tabletGrid = await page.locator(".v2-app").evaluate((node) => getComputedStyle(node).gridTemplateColumns);
  expect(tabletGrid.startsWith("76px ")).toBe(true);

  await page.setViewportSize({ width: 1200, height: 800 });
  const desktopGrid = await page.locator(".v2-app").evaluate((node) => getComputedStyle(node).gridTemplateColumns);
  expect(desktopGrid.startsWith("220px ")).toBe(true);
});
