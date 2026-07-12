const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { AI_CIO_DASHBOARD_CHANNEL } = require("../dist/packages/contracts/src/aiCioDashboard.js");
const { AiCioDashboardService } = require("../dist/apps/desktop/src/aiCioDashboardService.js");
const { registerAiCioReadOnlyIpc } = require("../dist/apps/desktop/src/aiCioIpcBridge.js");

test("registers only the input-free dashboard read channel", () => {
  const handlers = new Map();
  registerAiCioReadOnlyIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, { current: () => null }, () => 1_000);
  assert.deepEqual([...handlers.keys()], [AI_CIO_DASHBOARD_CHANNEL]);
  assert.deepEqual(handlers.get(AI_CIO_DASHBOARD_CHANNEL)(), { ok: false, status: "NO_DATA", message: "AI CIO dashboard is not available" });
});

test("converts internal source and validation errors to a fixed safe response", () => {
  const service = new AiCioDashboardService({ current: () => { throw new Error("C:\\private\\dokkaebi.db secret stack"); } }, () => 1_000);
  const result = service.getAiCioDashboard();
  assert.deepEqual(result, { ok: false, status: "UNAVAILABLE", message: "AI CIO dashboard is not available" });
  assert.doesNotMatch(JSON.stringify(result), /private|\.db|stack|secret/i);
  assert.ok(Object.isFrozen(result));
});

test("returns a validated immutable serializable envelope", () => {
  const envelope = { version: 1, mode: "PAPER", generatedAt: 900, expiresAt: 1_100, snapshot: { generatedAt: 900, status: "NO_DATA", tradingPermitted: false, warnings: [] } };
  const result = new AiCioDashboardService({ current: () => envelope }, () => 1_000).getAiCioDashboard();
  assert.equal(result.ok, true);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.snapshot));
});

test("preload dashboard namespace exposes no control, order, Node or DB method", () => {
  const source = readFileSync(join(process.cwd(), "apps/desktop/src/preload.ts"), "utf8");
  const dashboardBlock = source.slice(source.indexOf("const aiCioDashboard"), source.indexOf('contextBridge.exposeInMainWorld("dokkaebi"'));
  assert.match(dashboardBlock, /getAiCioDashboard/);
  assert.doesNotMatch(dashboardBlock, /placeOrder|setAutoTrade|startStrategy|stopStrategy|setStrategyQuantity|require\(|node:|Database/);
});
