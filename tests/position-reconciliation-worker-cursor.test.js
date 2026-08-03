const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../dist/apps/execution/src/index.js");
const contracts = require("../dist/packages/contracts/src/index.js");

const {
  InMemoryOrderOperationalRestrictionRepository,
  ScriptedSyntheticPositionProvider,
  runPositionReconciliationWorker
} = execution;

class Evidence {
  constructor() { this.records = new Map(); }
  append(result) {
    if (this.records.has(result.reconciliationId)) throw new Error("duplicate reconciliation");
    this.records.set(result.reconciliationId, result);
  }
  getById(id) { return this.records.get(id); }
}

function position(walletId, symbol, baseQtyRaw, avgEntryPriceRaw = 100n) {
  return {
    scopeType: contracts.PositionScopeType.WALLET,
    walletId,
    symbol,
    baseQtyRaw,
    quoteCostRaw: baseQtyRaw * avgEntryPriceRaw,
    avgEntryPriceRaw: baseQtyRaw === 0n ? undefined : avgEntryPriceRaw,
    realizedPnlRaw: 0n,
    status: baseQtyRaw === 0n ? contracts.PositionStatus.CLOSED : contracts.PositionStatus.OPEN,
    version: 1
  };
}

const policy = { maxPositionsPerRun: 2, baseQtyToleranceRaw: 0n, avgEntryPriceToleranceRaw: 0n };

test("without a cursor, a run always rescans the same alphabetically-first slice, starving later positions", () => {
  const positions = {
    list: () => [position("d", "SYM", 1n), position("c", "SYM", 1n), position("b", "SYM", 1n), position("a", "SYM", 1n)]
  };
  const provider = new ScriptedSyntheticPositionProvider([]);
  const scannedAcrossRuns = new Set();
  for (let i = 0; i < 5; i += 1) {
    const result = runPositionReconciliationWorker({
      runId: `no-cursor-${i}`,
      positions,
      provider,
      policy,
      restrictions: new InMemoryOrderOperationalRestrictionRepository(),
      evidence: new Evidence(),
      nowMs: 1000
    });
    result.results.forEach(r => scannedAcrossRuns.add(`${r.accountId}:${r.symbol}`));
  }
  assert.deepEqual([...scannedAcrossRuns].sort(), ["a:SYM", "b:SYM"], "positions c and d are never reachable without advancing a cursor");
});

test("passing nextCursor forward across runs eventually covers every position", () => {
  const positions = {
    list: () => [position("d", "SYM", 1n), position("c", "SYM", 1n), position("b", "SYM", 1n), position("a", "SYM", 1n)]
  };
  const provider = new ScriptedSyntheticPositionProvider([]);
  const scannedAcrossRuns = new Set();
  let cursor;
  for (let i = 0; i < 3; i += 1) {
    const result = runPositionReconciliationWorker({
      runId: `with-cursor-${i}`,
      positions,
      provider,
      policy,
      restrictions: new InMemoryOrderOperationalRestrictionRepository(),
      evidence: new Evidence(),
      cursor,
      nowMs: 1000
    });
    result.results.forEach(r => scannedAcrossRuns.add(`${r.accountId}:${r.symbol}`));
    cursor = result.nextCursor;
  }
  assert.deepEqual([...scannedAcrossRuns].sort(), ["a:SYM", "b:SYM", "c:SYM", "d:SYM"]);
});

test("cursor past the last position wraps around to the beginning", () => {
  const positions = { list: () => [position("a", "SYM", 1n), position("b", "SYM", 1n)] };
  const result = runPositionReconciliationWorker({
    runId: "wrap-1",
    positions,
    provider: new ScriptedSyntheticPositionProvider([]),
    policy,
    restrictions: new InMemoryOrderOperationalRestrictionRepository(),
    evidence: new Evidence(),
    cursor: "b:SYM",
    nowMs: 1000
  });
  assert.deepEqual(result.results.map(r => `${r.accountId}:${r.symbol}`), ["a:SYM", "b:SYM"]);
  assert.equal(result.truncated, false);
});

test("nextCursor is undefined when nothing was scanned", () => {
  const result = runPositionReconciliationWorker({
    runId: "empty-1",
    positions: { list: () => [] },
    provider: new ScriptedSyntheticPositionProvider([]),
    policy,
    restrictions: new InMemoryOrderOperationalRestrictionRepository(),
    evidence: new Evidence(),
    nowMs: 1000
  });
  assert.equal(result.nextCursor, undefined);
  assert.equal(result.truncated, false);
});
