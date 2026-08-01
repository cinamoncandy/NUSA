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
      onStatus: (handler) => { listeners.status = handler; handler("connected"); return () => {}; },
      onTicker: (handler) => { listeners.ticker = handler; handler({ trade_price: 90000000, signed_change_rate: 0 }); return () => {}; },
      onSnapshot: (handler) => { listeners.snapshot = handler; handler(snapshot); return () => {}; },
      onControl: (handler) => { listeners.control = handler; handler({ status: "STOPPED", autoTradeEnabled: false, events: [] }); return () => {}; },
      onChartPoint: (handler) => { listeners.chartPoint = handler; return () => {}; },
      placeOrder: async () => ({ snapshot }),
      startStrategy: async () => ({ status: "RUNNING", autoTradeEnabled: false, events: [] }),
      stopStrategy: async () => ({ status: "STOPPED", autoTradeEnabled: false, events: [] }),
      setAutoTrade: async () => ({ status: "STOPPED", autoTradeEnabled: false, events: [] }),
      setStrategyQuantity: async () => ({ status: "STOPPED", autoTradeEnabled: false, events: [] })
    };
    window.shadowPilot = {
      preflight: async () => ({}),
      status: async () => ({}),
      start: async () => ({}),
      pause: async () => ({}),
      resume: async () => ({}),
      stop: async () => ({})
    };
    window.operations = { snapshot: async () => ({}) };
    window.recoveryReview = {
      status: async () => ({}),
      reconcile: async () => ({}),
      ownerReview: async () => ({}),
      complete: async () => ({})
    };
    window.aiCioDashboard = { getAiCioDashboard: async () => ({ ok: false, status: "UNAVAILABLE" }) };
    window.nusaApp = {
      settings: async () => ({ settings: { theme: "light", logLevel: "INFO", showDiagnostics: true, showNotifications: true } }),
      about: async () => ({ about: { appVersion: "0.1.0", electronVersion: "test", nodeVersion: "test", mode: "Paper Trading" } }),
      saveSettings: async () => ({}),
      resetSettings: async () => ({}),
      firstRun: async () => ({ notice: null })
    };
  });
}

test("shared renderer keeps Paper state, navigation, and order confirmation on mobile", async ({ page }) => {
  await installRendererBridge(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/index.html");
  await expect(page.getByTestId("simple-ui-root")).toBeVisible();
  await expect(page.getByText("PAPER · 실거래 비활성")).toBeVisible();
  await expect(page.locator(".simple-bottom-nav [data-simple-nav]")).toHaveCount(5);
  expect(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator(".simple-bottom-nav [data-simple-nav='orders']").click();
  await expect(page.locator("[data-simple-page='orders']")).toBeVisible();
  await page.locator("[data-simple-order='BUY']").click();
  await expect(page.getByRole("dialog", { name: "Paper 주문 확인" })).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Paper Trading");
});

test("shared renderer uses touch navigation on tablet and a rail on desktop", async ({ page }) => {
  await installRendererBridge(page);
  await page.goto("/index.html");
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.locator(".simple-bottom-nav")).toBeVisible();
  await expect(page.locator(".simple-sidebar")).toBeHidden();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator(".simple-bottom-nav")).toBeHidden();
  await expect(page.locator(".simple-sidebar")).toBeVisible();
});
