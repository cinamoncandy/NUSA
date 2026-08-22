const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { StrategyEngine, SmaCrossoverStrategy } = require("../dist/apps/desktop/src/strategy/strategyEngine.js");
const { ShadowOperationalRuntime } = require("../dist/apps/desktop/src/shadow/shadowOperationalRuntime.js");
const { createShadowEvidenceBusFactory } = require("../dist/apps/desktop/src/shadow/shadowEvidenceComposition.js");
const { findIncompleteShadowArchivesSync } = require("../dist/apps/desktop/src/shadow/shadowEvidenceArchive.js");

const SYMBOL = "KRW-BTC";
const MINUTE = 60_000;
const CLOCK = Date.UTC(2026, 0, 2);
const COMMIT = "a".repeat(40);

function makeRepeatedRuntime(root) {
  const strategy = new StrategyEngine(new SmaCrossoverStrategy(5, 20));
  strategy.start();
  let now = CLOCK;
  let nextMinute = 20;
  let busCount = 0;
  const busFactory = createShadowEvidenceBusFactory({
    root,
    sourceCommitSha: COMMIT,
    symbol: SYMBOL,
    strategyId: "sma-crossover",
    strategyVersion: "sma-crossover:closed-candle-1m-v1",
    fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" }
  });
  const runtime = new ShadowOperationalRuntime({
    symbol: SYMBOL,
    strategyId: "sma-crossover",
    strategyVersion: "sma-crossover:closed-candle-1m-v1",
    strategyFingerprint: "s",
    sourceCommitSha: COMMIT,
    fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" },
    strategy,
    getPositionQuantity: () => 0,
    onProductionSignal: () => {},
    riskGate: { evaluate: () => ({ status: "ALLOW", reasonCodes: [] }) },
    getHypotheticalOrderQuantity: () => 0.001,
    maxSessionDurationMs: 2 * MINUTE,
    now: () => now,
    getSafetyState: () => ({
      deploymentIntegrity: true,
      reconciliation: true,
      killSwitch: false,
      openP0: false,
      automaticTrading: false,
      currentModeIsCanaryOrExtended: false
    }),
    createEvidenceBus: (metadata) => {
      busCount += 1;
      return busFactory(metadata);
    },
    findIncompleteEvidence: () => {
      try { return findIncompleteShadowArchivesSync(root); }
      catch (error) { if (error?.code === "ENOENT") return []; throw error; }
    }
  });
  return {
    runtime,
    get busCount() { return busCount; },
    warmUp() {
      runtime.onWebSocketStatus("connected");
      for (let minute = 0; minute <= 20; minute += 1) {
        now = CLOCK + minute * MINUTE;
        runtime.onTicker({ code: SYMBOL, trade_price: 100, trade_timestamp: now, trade_volume: 1, trade_id: `warm-${minute}` });
      }
      nextMinute = 20;
    },
    candles(count) {
      for (let index = 0; index < count; index += 1) {
        nextMinute += 1;
        now = CLOCK + nextMinute * MINUTE;
        runtime.onTicker({ code: SYMBOL, trade_price: 100 + index * 100, trade_timestamp: now, trade_volume: 1, trade_id: `candle-${nextMinute}` });
      }
    }
  };
}

test("A4J: repeated sessions stay isolated and append one completion evidence per session", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "a4j-repeated-shadow-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const h = makeRepeatedRuntime(root);
  const results = [];

  for (let index = 0; index < 3; index += 1) {
    h.warmUp();
    const started = h.runtime.start();
    assert.equal(started.state, "RUNNING", JSON.stringify(started));
    if (index === 1) {
      h.candles(1);
      assert.equal(h.runtime.stop().state, "COMPLETED");
    } else {
      h.candles(3);
      assert.equal(h.runtime.diagnostics().state, "COMPLETED");
    }
    await h.runtime.awaitEvidenceFinalized();
    const completed = h.runtime.diagnostics();
    results.push(completed);
    assert.equal(completed.actualBrokerCallCount, 0);
    assert.equal(completed.actualOrderCount, 0);
    assert.equal(completed.actualFillCount, 0);
    assert.equal(completed.cashMutationCount, 0);
    assert.equal(completed.positionMutationCount, 0);
    assert.equal(completed.executionGateCallCount, 0);
    assert.equal(completed.productionMutationAllowed, false);
    if (index < 2) {
      const next = await h.runtime.prepareForNextSession();
      assert.equal(next.state, "IDLE");
      assert.equal(next.sessionId, null);
      assert.equal(next.signalCount, 0);
      assert.equal(next.actualOrderCount, 0);
      assert.equal(next.cashMutationCount, 0);
    }
  }

  const ids = results.map((result) => result.sessionId);
  assert.equal(new Set(ids).size, 3, "every session must have a unique sessionId");
  assert.equal(h.busCount, 3, "one fresh evidence bus per session");

  const archives = (await fsp.readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name));
  assert.equal(archives.length, 3, "completed sessions accumulate instead of overwriting");
  const completions = await Promise.all(archives.map(async (directory) => JSON.parse(await fsp.readFile(path.join(directory, "completion.json"), "utf8"))));
  assert.equal(completions.length, 3);
  assert.equal(new Set(completions.map((completion) => completion.sessionId)).size, 3);
  for (const completion of completions) {
    assert.ok(completion.startedAt <= completion.completedAt);
    assert.ok(completion.createdAt <= completion.completedAt);
    assert.equal(completion.actualOrderCount, 0);
    assert.equal(completion.actualFillCount, 0);
    assert.equal(completion.cashMutationCount, 0);
    assert.equal(completion.positionMutationCount, 0);
    assert.equal(completion.brokerCallCount, 0);
    assert.equal(completion.privateApiCallCount, 0);
    assert.equal(completion.safety, "SAFE_COMPLETION");
  }
  assert.equal(new Set(completions.map((completion) => completion.completionReason)).size, 2, "owner stop and duration completion remain distinguishable");
  assert.equal(findIncompleteShadowArchivesSync(root).length, 0);
});

test("A4J: completed sessions cannot be restarted without explicit cleanup, and halted sessions cannot be cleared", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "a4j-lifecycle-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const h = makeRepeatedRuntime(root);
  h.warmUp();
  h.runtime.start();
  h.candles(3);
  assert.equal(h.runtime.diagnostics().state, "COMPLETED");
  assert.throws(() => h.runtime.start(), /requires IDLE/);
  await h.runtime.prepareForNextSession();
  assert.equal(h.runtime.diagnostics().blockers.length, 0);

  h.warmUp();
  const next = h.runtime.start();
  assert.equal(next.state, "RUNNING", JSON.stringify(next));
  assert.notEqual(next.sessionId, null);
  h.runtime.onWebSocketStatus("reconnect-exhausted");
  assert.equal(h.runtime.diagnostics().state, "HALTED");
  await assert.rejects(() => h.runtime.prepareForNextSession(), /requires COMPLETED/);
  await h.runtime.awaitEvidenceFinalized();
});

test("A4J: session runtime owns no timer or market listener that could duplicate across runs", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "apps", "desktop", "src", "shadow", "shadowOperationalRuntime.ts"), "utf8");
  assert.doesNotMatch(source, /setInterval|setTimeout|addEventListener|removeEventListener/);
});
