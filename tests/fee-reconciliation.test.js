const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../dist/apps/execution/src/index.js");

const {
  FeeLiquidityRole,
  FeeReconciliationStatus,
  InMemoryOrderOperationalRestrictionRepository,
  ScriptedSyntheticTradeFeeProvider,
  reconcileTradeFees
} = execution;

class Evidence {
  constructor() { this.records = new Map(); }
  append(result) { if (this.records.has(result.reconciliationId)) throw new Error("duplicate"); this.records.set(result.reconciliationId, result); }
  getById(id) { return this.records.get(id); }
  getLatest(accountId) { return [...this.records.values()].filter(v => v.accountId === accountId).sort((a,b) => b.observedAtMs - a.observedAtMs || b.reconciliationId.localeCompare(a.reconciliationId))[0]; }
}
const fee = (overrides = {}) => ({ tradeId: "trade-1", orderId: "order-1", accountId: "acct", symbol: "BTCUSDT", asset: "USDT", amountRaw: 10n, liquidityRole: FeeLiquidityRole.MAKER, tradeTimeMs: 100, ...overrides });
function run(local, remote, id = "fee-run") {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const evidence = new Evidence();
  const result = reconcileTradeFees({ reconciliationId: id, restrictionId: `restriction-${id}`, accountId: "acct", local, provider: new ScriptedSyntheticTradeFeeProvider(remote), fromMs: 0, toMs: 200, nowMs: 200, policy: { amountToleranceRaw: 1n }, restrictions, evidence });
  return { result, restrictions, evidence };
}

test("matching trade fees do not create a restriction", () => {
  const { result, restrictions } = run([fee()], [fee()]);
  assert.equal(result.status, FeeReconciliationStatus.MATCHED);
  assert.equal(restrictions.getActiveForAccount("acct"), undefined);
});

test("missing provider trade fee blocks new exposure", () => {
  const { result, restrictions } = run([fee()], []);
  assert.equal(result.status, FeeReconciliationStatus.MISSING_PROVIDER);
  assert.equal(restrictions.getActiveForAccount("acct").blockNewExposure, true);
});

test("fee asset mismatch is explicit", () => {
  const { result } = run([fee()], [fee({ asset: "BNB" })]);
  assert.equal(result.status, FeeReconciliationStatus.ASSET_MISMATCH);
  assert.deepEqual(result.mismatchTradeIds, ["trade-1"]);
});

test("maker taker mismatch is explicit", () => {
  const { result } = run([fee()], [fee({ liquidityRole: FeeLiquidityRole.TAKER })]);
  assert.equal(result.status, FeeReconciliationStatus.LIQUIDITY_ROLE_MISMATCH);
});

test("amount mismatch beyond tolerance is blocked", () => {
  const { result } = run([fee()], [fee({ amountRaw: 12n })]);
  assert.equal(result.status, FeeReconciliationStatus.AMOUNT_MISMATCH);
});

test("duplicate provider trade IDs are rejected", () => {
  const { result } = run([fee()], [fee(), fee()]);
  assert.equal(result.status, FeeReconciliationStatus.DUPLICATE_PROVIDER);
});

test("unavailable provider state remains uncertain", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const evidence = new Evidence();
  const result = reconcileTradeFees({ reconciliationId: "unavailable", restrictionId: "restriction-unavailable", accountId: "acct", local: [fee()], provider: new ScriptedSyntheticTradeFeeProvider(undefined), fromMs: 0, toMs: 200, nowMs: 200, policy: { amountToleranceRaw: 0n }, restrictions, evidence });
  assert.equal(result.status, FeeReconciliationStatus.PROVIDER_UNAVAILABLE);
  assert.equal(restrictions.getActiveForAccount("acct").blockNewExposure, true);
});
