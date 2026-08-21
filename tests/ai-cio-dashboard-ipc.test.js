const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { AI_CIO_DASHBOARD_CHANNEL } = require("../dist/packages/contracts/src/aiCioDashboard.js");
const { AiCioDashboardService } = require("../dist/apps/desktop/src/ai/aiCioDashboardService.js");
const { registerAiCioReadOnlyIpc } = require("../dist/apps/desktop/src/ai/aiCioIpcBridge.js");

const section = (overrides = {}) => ({ status: "BLOCKED", availability: "UNAVAILABLE", generatedAt: 900, reasons: ["SOURCE_NOT_CONNECTED"], ...overrides });
const snapshot = (overrides = {}) => ({
  generatedAt: 900,
  status: "BLOCKED",
  tradingPermitted: false,
  portfolio: section({ totalEquity: 0, deployableCapital: 0, reservedCapital: 0, grossExposureRatio: 0, netExposureRatio: 0 }),
  opportunities: section({ activeCount: 0, totalAllocatedCapital: 0, reservedCash: 0 }),
  strategies: section({ totalTrades: 0, totalNetPnl: 0, portfolioCaptureRatio: 0, blockedStrategies: 0, warningStrategies: 0 }),
  committee: section({ decision: "WAIT", confidence: 0, edge: 0, risk: 0, conflictLevel: "HIGH" }),
  execution: section({ fillQuality: 0, slippageBps: 0, latencyMs: 0 }),
  research: section({ walkForwardPassed: false, monteCarloPassed: false, costStressPassed: false, paperPromotionEligible: false }),
  risk: section({ killSwitchActive: false, dailyDrawdownRatio: 0, liquidationBufferRatio: 0, portfolioHeatRatio: 0 }),
  warnings: ["SOURCE_NOT_CONNECTED"],
  ...overrides
});

test("registers only the input-free dashboard read channel", () => {
  const handlers = new Map();
  registerAiCioReadOnlyIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, { current: () => null }, () => 1_000);
  assert.deepEqual([...handlers.keys()], [AI_CIO_DASHBOARD_CHANNEL]);
  assert.deepEqual(handlers.get(AI_CIO_DASHBOARD_CHANNEL)(), { ok: false, status: "NO_DATA", message: "AI CIO dashboard is not available" });
});

test("converts internal source and validation errors to a fixed safe response", () => {
  const service = new AiCioDashboardService({ current: () => { throw new Error("C:\\private\\nusa.db secret stack"); } }, () => 1_000);
  const result = service.getAiCioDashboard();
  assert.deepEqual(result, { ok: false, status: "UNAVAILABLE", message: "AI CIO dashboard is not available" });
  assert.doesNotMatch(JSON.stringify(result), /private|\.db|stack|secret/i);
  assert.ok(Object.isFrozen(result));
});

test("returns a validated immutable serializable envelope", () => {
  const envelope = { version: 1, mode: "PAPER", generatedAt: 900, expiresAt: 1_100, snapshot: snapshot() };
  const result = new AiCioDashboardService({ current: () => envelope }, () => 1_000).getAiCioDashboard();
  assert.equal(result.ok, true);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.snapshot));
});

test("preload dashboard namespace exposes no control, order, Node or DB method", () => {
  const source = readFileSync(join(process.cwd(), "apps/desktop/src/preload.ts"), "utf8");
  const dashboardBlock = source.slice(source.indexOf("const aiCioDashboard"), source.indexOf('contextBridge.exposeInMainWorld("nusa"'));
  assert.match(dashboardBlock, /getAiCioDashboard/);
  assert.doesNotMatch(dashboardBlock, /placeOrder|setAutoTrade|startStrategy|stopStrategy|setStrategyQuantity|require\(|node:|Database/);
});

test("malformed nested dashboard state fails closed without leaking validation details", () => {
  for (const malformed of [
    snapshot({ risk: undefined }),
    snapshot({ status: "BLOCKED", tradingPermitted: true }),
    snapshot({ committee: section({ availability: "UNKNOWN", decision: "WAIT", confidence: 0, edge: 0, risk: 0, conflictLevel: "HIGH" }) }),
    snapshot({ warnings: [""] })
  ]) {
    const envelope = { version: 1, mode: "PAPER", generatedAt: 900, expiresAt: 1_100, snapshot: malformed };
    const result = new AiCioDashboardService({ current: () => envelope }, () => 1_000).getAiCioDashboard();
    assert.deepEqual(result, { ok: false, status: "UNAVAILABLE", message: "AI CIO dashboard is not available" });
  }
});
