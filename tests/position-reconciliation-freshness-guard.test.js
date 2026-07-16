const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../dist/apps/execution/src/index.js");
const contracts = require("../dist/packages/contracts/src/index.js");

const {
  InMemoryOrderOperationalRestrictionRepository,
  OrderOperationalRestrictionReason,
  PositionReconciliationStatus,
  enforcePositionReconciliationFreshness
} = execution;

function position(walletId, symbol, baseQtyRaw) {
  return {
    scopeType: contracts.PositionScopeType.WALLET,
    walletId,
    symbol,
    baseQtyRaw,
    quoteCostRaw: baseQtyRaw * 100n,
    avgEntryPriceRaw: baseQtyRaw === 0n ? undefined : 100n,
    realizedPnlRaw: 0n,
    status: baseQtyRaw === 0n ? contracts.PositionStatus.CLOSED : contracts.PositionStatus.OPEN,
    version: 1
  };
}

class Evidence {
  constructor(records = []) { this.records = records; }
  append(result) { this.records.push(result); }
  getById(id) { return this.records.find(record => record.reconciliationId === id); }
  getLatestForScope(accountId, symbol) {
    return this.records
      .filter(record => record.accountId === accountId && record.symbol === symbol)
      .sort((left, right) => right.observedAtMs - left.observedAtMs || right.reconciliationId.localeCompare(left.reconciliationId))[0];
  }
}

function matched(id, accountId, symbol, observedAtMs) {
  return {
    reconciliationId: id,
    accountId,
    symbol,
    status: PositionReconciliationStatus.MATCHED,
    localBaseQtyRaw: 1n,
    providerBaseQtyRaw: 1n,
    baseQtyDifferenceRaw: 0n,
    localAvgEntryPriceRaw: 100n,
    providerAvgEntryPriceRaw: 100n,
    avgEntryPriceDifferenceRaw: 0n,
    observedAtMs
  };
}

test("stale matched evidence blocks new exposure for an open position", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const result = enforcePositionReconciliationFreshness({
    guardRunId: "freshness-1",
    positions: { list: () => [position("account-1", "BTCUSDT", 1n)] },
    evidence: new Evidence([matched("match-old", "account-1", "BTCUSDT", 1000)]),
    restrictions,
    maximumAgeMs: 1000,
    warningAgeMs: 500,
    nowMs: 2000
  });
  assert.equal(result.staleCount, 1);
  assert.equal(result.restrictionCount, 1);
  assert.equal(restrictions.getActiveForAccount("account-1").reason, OrderOperationalRestrictionReason.POSITION_RECONCILIATION_STALE);
});

test("fresh matched evidence does not create a restriction", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const result = enforcePositionReconciliationFreshness({
    guardRunId: "freshness-2",
    positions: { list: () => [position("account-1", "BTCUSDT", 1n)] },
    evidence: new Evidence([matched("match-fresh", "account-1", "BTCUSDT", 1800)]),
    restrictions,
    maximumAgeMs: 1000,
    warningAgeMs: 500,
    nowMs: 2000
  });
  assert.equal(result.staleCount, 0);
  assert.equal(result.missingCount, 0);
  assert.equal(result.restrictionCount, 0);
});

test("missing evidence blocks open positions but ignores closed positions", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const result = enforcePositionReconciliationFreshness({
    guardRunId: "freshness-3",
    positions: { list: () => [position("account-1", "BTCUSDT", 1n), position("account-2", "ETHUSDT", 0n)] },
    evidence: new Evidence(),
    restrictions,
    maximumAgeMs: 1000,
    warningAgeMs: 500,
    nowMs: 2000
  });
  assert.equal(result.checkedCount, 1);
  assert.equal(result.missingCount, 1);
  assert.equal(restrictions.getActiveForAccount("account-1").reason, OrderOperationalRestrictionReason.POSITION_RECONCILIATION_STALE);
  assert.equal(restrictions.getActiveForAccount("account-2"), undefined);
});
