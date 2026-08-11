const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const {
  PaperTradingExecutionLoop,
  SqliteCloudPaperAccountRepository
} = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");

const market = "KRW-BTC";
const baseTick = (overrides = {}) => ({
  now: 1_000,
  market,
  price: 100,
  observedAt: 1_000,
  mode: "PAPER",
  killSwitchActive: false,
  tradingAllowed: true,
  overallHealth: "HEALTHY",
  decisions: [{
    symbol: market,
    action: "BUY",
    confidence: 1,
    risk: "LOW",
    allocation: 0.5,
    leverage: 1,
    score: 0.8,
    reasons: ["test"],
    decidedAt: 1_000
  }],
  ...overrides
});

const sellTick = (overrides = {}) => baseTick({
  now: 2_000,
  price: 120,
  observedAt: 2_000,
  decisions: [{
    symbol: market,
    action: "SELL",
    confidence: 1,
    risk: "LOW",
    allocation: 0,
    leverage: 1,
    score: -0.8,
    reasons: ["exit"],
    decidedAt: 2_000
  }],
  ...overrides
});

function baseDashboard(now = 1_000) {
  return {
    now,
    mode: "PAPER",
    killSwitchActive: false,
    overallHealth: "HEALTHY",
    headline: "Paper dashboard",
    issues: [],
    portfolio: { allocations: [], deployedCapital: 0, cashCapital: 1_000, reservedCapital: 0, grossShare: 0, futuresShare: 0, decidedAt: now },
    decisions: [],
    intelligence: { signals: [], staleSources: [], generatedAt: now }
  };
}

test("initial paper account is cash-only and deterministic", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000 });
  assert.deepEqual(loop.snapshot(), {
    version: 1, initialCapital: 1_000, cash: 1_000, equity: 1_000,
    realizedPnL: 0, unrealizedPnL: 0, positions: [], orders: [], fills: [],
    processedIdempotencyKeys: [], updatedAt: 0
  });
});

test("BUY fills at market price, applies fee and updates weighted position", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000, feeRate: 0.01 });
  const result = loop.processTick(baseTick());
  assert.equal(result.status, "FILLED");
  assert.equal(result.orders.length, 1);
  assert.equal(result.fills.length, 1);
  assert.equal(result.state.positions[0].quantity, 5);
  assert.equal(result.state.positions[0].averageEntryPrice, 101);
  assert.equal(result.state.cash, 495);
  assert.equal(result.state.equity, 995);
});

test("SELL closes the position and records realized PnL after fees", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000, feeRate: 0.01 });
  loop.processTick(baseTick());
  const result = loop.processTick(sellTick());
  assert.equal(result.status, "FILLED");
  assert.equal(result.state.positions[0].quantity, 0);
  assert.equal(result.state.cash, 1_089);
  assert.equal(result.state.realizedPnL, 89);
  assert.equal(result.state.unrealizedPnL, 0);
});

test("WAIT leaves account unchanged", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000 });
  const result = loop.processTick(baseTick({ decisions: [{ ...baseTick().decisions[0], action: "WAIT" }] }));
  assert.equal(result.status, "WAIT");
  assert.deepEqual(result.state, loop.snapshot());
  assert.equal(result.state.orders.length, 0);
});

test("insufficient cash and oversell are rejected without mutation", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 100, feeRate: 0.01 });
  const insufficient = loop.processTick(baseTick({ price: 100, quantity: 2 }));
  assert.equal(insufficient.status, "REJECTED");
  assert.equal(insufficient.state.cash, 100);
  const funded = new PaperTradingExecutionLoop({ initialCapital: 1_000 });
  funded.processTick(baseTick());
  const before = funded.snapshot();
  const oversell = funded.processTick(sellTick({ quantity: 6 }));
  assert.equal(oversell.status, "REJECTED");
  assert.deepEqual(oversell.state, before);
});

test("stale, kill-switched and disallowed ticks fail closed", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000, staleWindowMs: 1_000 });
  assert.equal(loop.processTick(baseTick({ observedAt: 0 })).status, "BLOCKED");
  assert.equal(loop.processTick(baseTick({ killSwitchActive: true })).status, "BLOCKED");
  assert.equal(loop.processTick(baseTick({ tradingAllowed: false })).status, "BLOCKED");
  assert.equal(loop.processTick(baseTick({ mode: "STOPPED" })).status, "BLOCKED");
  assert.equal(loop.snapshot().orders.length, 0);
});

test("duplicate ticks are idempotent", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000 });
  assert.equal(loop.processTick(baseTick()).status, "FILLED");
  const duplicate = loop.processTick(baseTick());
  assert.equal(duplicate.status, "DUPLICATE");
  assert.equal(loop.snapshot().orders.length, 1);
  assert.equal(loop.snapshot().fills.length, 1);
});

test("SQLite repository restores the account after restart", () => {
  const filename = join(mkdtempSync(join(tmpdir(), "nusa-paper-account-")), "paper.db");
  const firstDb = new SqliteDatabase(filename);
  const first = new PaperTradingExecutionLoop({ initialCapital: 1_000, repository: new SqliteCloudPaperAccountRepository(firstDb) });
  first.processTick(baseTick());
  firstDb.close();
  const secondDb = new SqliteDatabase(filename);
  const second = new PaperTradingExecutionLoop({ initialCapital: 1_000, repository: new SqliteCloudPaperAccountRepository(secondDb) });
  assert.equal(second.snapshot().orders.length, 1);
  assert.equal(second.snapshot().positions[0].quantity, 5);
  secondDb.close();
  rmSync(filename, { force: true });
});

test("persistence failure does not publish a changed account", () => {
  const repository = { save() { throw new Error("disk full"); }, loadLatest() { return undefined; }, clear() {} };
  const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000, repository });
  const result = loop.processTick(baseTick());
  assert.equal(result.status, "FAILED");
  assert.equal(result.state.orders.length, 0);
  assert.equal(loop.snapshot().cash, 1_000);
});

test("dashboard projection agrees with the durable paper account", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000 });
  loop.processTick(baseTick());
  const dashboard = loop.applyToDashboard(baseDashboard(), 1_000);
  assert.equal(dashboard.portfolio.cashCapital, loop.snapshot().cash);
  assert.equal(dashboard.portfolio.deployedCapital, 500);
  assert.equal(dashboard.portfolio.deployedCapital + dashboard.portfolio.cashCapital, loop.snapshot().equity);
  assert.equal(dashboard.paper.realizedPnL, loop.snapshot().realizedPnL);
  assert.equal(dashboard.paper.orders.length, 1);
  assert.equal(dashboard.paper.fills.length, 1);
});

test("paper BUY applies the configured investable cash percentage", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000, feeRate: 0 });
  const result = loop.processTick(baseTick({ investmentPercent: 60 }));
  assert.equal(result.status, "FILLED");
  assert.equal(result.state.cash, 700);
  assert.equal(result.state.positions[0].quantity, 3);
});

test("paper BUY exceeding the protected cash envelope is rejected", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 1_000, feeRate: 0 });
  const result = loop.processTick(baseTick({ investmentPercent: 60, quantity: 7 }));
  assert.equal(result.status, "REJECTED");
  assert.match(result.reason, /exceeds deployable capital/);
  assert.equal(loop.snapshot().orders.length, 0);
});
