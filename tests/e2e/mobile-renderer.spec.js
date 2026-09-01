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
    const control = { status: "STOPPED", autoTradeEnabled: false, events: [] };
    window.nusa = {
      getSnapshot: async () => snapshot,
      getControlSnapshot: async () => control,
      getA4Diagnostics: async () => ({}),
      onStatus: (handler) => { listeners.status = handler; handler("connected"); return () => {}; },
      onTicker: (handler) => { listeners.ticker = handler; handler({ trade_price: 90000000, signed_change_rate: 0 }); return () => {}; },
      onSnapshot: (handler) => { listeners.snapshot = handler; handler(snapshot); return () => {}; },
      onControl: (handler) => { listeners.control = handler; handler(control); return () => {}; },
      onChartPoint: (handler) => { listeners.chartPoint = handler; return () => {}; }
    };
    window.shadowPilot = {
      preflight: async () => ({}), status: async () => ({}), start: async () => ({}), pause: async () => ({}), resume: async () => ({}), stop: async () => ({})
    };
    window.operations = { snapshot: async () => ({}) };
    window.recoveryReview = {
      status: async () => ({}), reconcile: async () => ({}), ownerReview: async () => ({}), complete: async () => ({})
    };
    window.aiCioDashboard = { getAiCioDashboard: async () => ({ ok: false, status: "UNAVAILABLE" }) };
    window.nusaApp = {
      settings: async () => ({ settings: { theme: "dark", logLevel: "INFO", showDiagnostics: true, showNotifications: true } }),
      about: async () => ({ about: { appVersion: "0.1.0", electronVersion: "test", nodeVersion: "test", mode: "Paper Trading" } }),
      saveSettings: async () => ({}), resetSettings: async () => ({}), firstRun: async () => ({ notice: null })
    };
  });
}

test("mobile renderer prioritizes supervision, PAPER results, and REAL approval safety", async ({ page }) => {
  await installRendererBridge(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/index.html");

  await expect(page.getByTestId("simple-ui-root")).toBeVisible();
  await expect(page.getByText("PAPER 자동 학습")).toBeVisible();
  await expect(page.getByText("REAL 승인 필요")).toBeVisible();
  await expect(page.locator(".nusa-bottom-nav [data-nav]")).toHaveCount(5);
  await expect(page.locator(".nusa-sidebar")).toBeHidden();
  expect(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(true);

  await expect(page.getByText("PAPER 학습 결과").first()).toBeVisible();
  await expect(page.getByText(/Paper 매수|Paper 매도/)).toHaveCount(0);

  await page.locator(".nusa-bottom-nav [data-nav='settings']").click();
  await expect(page.locator("[data-page='settings']")).toBeVisible();
  await expect(page.getByText("비밀번호 + 지문")).toBeVisible();
  await expect(page.getByText("허용 안 함")).toBeVisible();
  await expect(page.getByText("판단됨 ≠ 승인됨 ≠ 주문됨 ≠ 체결됨")).toBeVisible();
});

test("renderer uses bottom navigation on tablet and desktop rail above breakpoint", async ({ page }) => {
  await installRendererBridge(page);
  await page.goto("/index.html");

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.locator(".nusa-bottom-nav")).toBeVisible();
  await expect(page.locator(".nusa-sidebar")).toBeHidden();

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator(".nusa-bottom-nav")).toBeHidden();
  await expect(page.locator(".nusa-sidebar")).toBeVisible();
  await expect(page.locator(".nusa-sidebar [data-nav]")).toHaveCount(5);
});
