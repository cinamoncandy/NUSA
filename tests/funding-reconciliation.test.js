const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../dist/apps/execution/src/index.js");

const {
  FundingReconciliationStatus,
  InMemoryOrderOperationalRestrictionRepository,
  ScriptedSyntheticFundingFeeProvider,
  reconcileFundingFees
} = execution;

class Evidence {
  constructor() { this.records = new Map(); }
  append(result) {
    if (this.records.has(result.reconciliationId)) throw new Error("duplicate evidence");
    this.records.set(result.reconciliationId, result);
  }
  getById(id) { return this.records.get(id); }
}

const record = (id, amountRaw = 10n) => ({
  fundingId: id,
  accountId: "acct-1",
  symbol: "BTCUSDT",
  asset: "USDT",
  amountRaw,
  fundingTimeMs: 1000
});

function run(local, remote, id = "funding-1") {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const evidence = new Evidence();
  const result = reconcileFundingFees({
    reconciliationId: id,
    restrictionId: `restriction-${id}`,
    accountId: "acct-1",
    local,
    provider: new ScriptedSyntheticFundingFeeProvider(remote),
    fromMs: 0,
    toMs: 2000,
    policy: { amountToleranceRaw: 0n },
    restrictions,
    evidence,
    nowMs: 3000
  });
  return { result, restrictions, evidence };
}

test("matching funding fees remain unrestricted", () => {
  const { result, restrictions } = run([record("f-1")], [record("f-1")]);
  assert.equal(result.status, FundingReconciliationStatus.MATCHED);
  assert.equal(restrictions.getActiveForAccount("acct-1"), undefined);
});

test("missing local funding fee blocks new exposure", () => {
  const { result, restrictions } = run([], [record("f-1")]);
  assert.equal(result.status, FundingReconciliationStatus.MISSING_LOCAL);
  assert.equal(restrictions.getActiveForAccount("acct-1").blockNewExposure, true);
  assert.deepEqual(result.mismatchFundingIds, ["f-1"]);
});

test("amount mismatch is detected", () => {
  const { result } = run([record("f-1", 10n)], [record("f-1", 11n)]);
  assert.equal(result.status, FundingReconciliationStatus.AMOUNT_MISMATCH);
});

test("duplicate provider funding IDs are detected", () => {
  const { result } = run([record("f-1")], [record("f-1"), record("f-1")]);
  assert.equal(result.status, FundingReconciliationStatus.DUPLICATE_PROVIDER);
});

test("provider unavailability preserves uncertainty", () => {
  const { result, restrictions } = run([record("f-1")], undefined);
  assert.equal(result.status, FundingReconciliationStatus.PROVIDER_UNAVAILABLE);
  assert.equal(restrictions.getActiveForAccount("acct-1").blockNewExposure, true);
});
