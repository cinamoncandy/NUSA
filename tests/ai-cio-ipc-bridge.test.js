const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAiCioCommandCenterEnvelope } = require("../dist/apps/desktop/src/ai/aiCioCommandCenterAdapter.js");
const { AI_CIO_SNAPSHOT_CHANNEL, InMemoryAiCioEnvelopeSource, registerAiCioReadOnlyIpc } = require("../dist/apps/desktop/src/ai/aiCioIpcBridge.js");

const section = (overrides = {}) => ({ status: "HEALTHY", generatedAt: 1_000, reasons: [], ...overrides });
const snapshot = (overrides = {}) => ({
  generatedAt: 1_000,
  status: "HEALTHY",
  tradingPermitted: true,
  portfolio: section({ totalEquity: 100, deployableCapital: 80, reservedCapital: 20, grossExposureRatio: 0.2, netExposureRatio: 0.1 }),
  opportunities: section({ activeCount: 1, totalAllocatedCapital: 10, reservedCash: 70 }),
  strategies: section({ totalTrades: 5, totalNetPnl: 2, portfolioCaptureRatio: 0.8, blockedStrategies: 0, warningStrategies: 0 }),
  committee: section({ decision: "APPROVE", confidence: 0.8, edge: 0.1, risk: 0.2, conflictLevel: "LOW" }),
  execution: section({ fillQuality: 0.95, slippageBps: 2, latencyMs: 30 }),
  research: section({ walkForwardPassed: true, monteCarloPassed: true, costStressPassed: true, paperPromotionEligible: true }),
  risk: section({ killSwitchActive: false, dailyDrawdownRatio: 0.01, liquidationBufferRatio: 1, portfolioHeatRatio: 0.2 }),
  warnings: [],
  ...overrides
});

class FakeRegistrar {
  constructor() { this.handlers = new Map(); }
  handle(channel, listener) {
    if (this.handlers.has(channel)) throw new Error("duplicate channel");
    this.handlers.set(channel, listener);
  }
}

test("registers one read-only channel and returns NO_DATA before publication", () => {
  const registrar = new FakeRegistrar();
  const source = new InMemoryAiCioEnvelopeSource();
  registerAiCioReadOnlyIpc(registrar, source, () => 1_000);
  assert.deepEqual([...registrar.handlers.keys()], [AI_CIO_SNAPSHOT_CHANNEL]);
  assert.deepEqual(registrar.handlers.get(AI_CIO_SNAPSHOT_CHANNEL)(), { ok: false, status: "NO_DATA", message: "AI CIO dashboard is not available" });
});

test("returns a validated immutable envelope", () => {
  const realNow = Date.now();
  const source = new InMemoryAiCioEnvelopeSource();
  const envelope = buildAiCioCommandCenterEnvelope({ mode: "PAPER", snapshot: snapshot({ generatedAt: realNow }), maximumAgeMs: 1_000 }, realNow);
  source.publish(envelope);
  const registrar = new FakeRegistrar();
  registerAiCioReadOnlyIpc(registrar, source, () => realNow + 1);
  const result = registrar.handlers.get(AI_CIO_SNAPSHOT_CHANNEL)();
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.version, 1);
  assert.equal(result.snapshot.mode, "PAPER");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.snapshot));
  assert.ok(Object.isFrozen(result.snapshot.snapshot));
});

test("fails closed when the published envelope expires", () => {
  const realNow = Date.now();
  const source = new InMemoryAiCioEnvelopeSource();
  // maximumAgeMs must be wide enough that InMemoryAiCioEnvelopeSource.publish()'s own
  // validateAiCioCommandCenterEnvelope(envelope, Date.now()) check -- which validates
  // against the real wall clock, not an injectable one -- reliably still sees the
  // envelope as fresh on a loaded CI runner, while the injected read-time offset below
  // still safely exceeds it to exercise the intended stale-at-read behavior.
  source.publish(buildAiCioCommandCenterEnvelope({ mode: "DRY_RUN", snapshot: snapshot({ generatedAt: realNow }), maximumAgeMs: 200 }, realNow));
  const registrar = new FakeRegistrar();
  registerAiCioReadOnlyIpc(registrar, source, () => realNow + 250);
  assert.deepEqual(registrar.handlers.get(AI_CIO_SNAPSHOT_CHANNEL)(), { ok: false, status: "UNAVAILABLE", message: "AI CIO dashboard is not available" });
});

test("clear removes the renderer-visible snapshot", () => {
  const realNow = Date.now();
  const source = new InMemoryAiCioEnvelopeSource();
  source.publish(buildAiCioCommandCenterEnvelope({ mode: "PAPER", snapshot: snapshot({ generatedAt: realNow }), maximumAgeMs: 100 }, realNow));
  source.clear();
  const registrar = new FakeRegistrar();
  registerAiCioReadOnlyIpc(registrar, source, () => realNow);
  assert.deepEqual(registrar.handlers.get(AI_CIO_SNAPSHOT_CHANNEL)(), { ok: false, status: "NO_DATA", message: "AI CIO dashboard is not available" });
});
