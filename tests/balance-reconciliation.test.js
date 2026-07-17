const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../dist/apps/execution/src/index.js");

const {
  BalanceReconciliationStatus,
  InMemoryOrderOperationalRestrictionRepository,
  OrderOperationalRestrictionReason,
  ScriptedSyntheticBalanceProvider,
  reconcileBalance
} = execution;

class Evidence {
  constructor() { this.records = new Map(); }
  append(result) {
    if (this.records.has(result.reconciliationId)) throw new Error("duplicate reconciliation");
    this.records.set(result.reconciliationId, result);
  }
  getById(id) { return this.records.get(id); }
  getLatest(accountId, asset) {
    return [...this.records.values()]
      .filter(item => item.accountId === accountId && item.asset === asset)
      .sort((a, b) => b.observedAtMs - a.observedAtMs || b.reconciliationId.localeCompare(a.reconciliationId))[0];
  }
}

const local = {
  accountId: "account-1",
  asset: "USDT",
  walletBalanceRaw: 1000n,
  availableBalanceRaw: 800n,
  observedAtMs: 1000
};
const policy = { walletBalanceToleranceRaw: 0n, availableBalanceToleranceRaw: 0n };

function run(provider, overrides = {}) {
  const restrictions = overrides.restrictions ?? new InMemoryOrderOperationalRestrictionRepository();
  const evidence = overrides.evidence ?? new Evidence();
  const result = reconcileBalance({
    reconciliationId: overrides.reconciliationId ?? "balance-1",
    restrictionId: overrides.restrictionId ?? "restriction-1",
    local: overrides.local ?? local,
    provider,
    policy: overrides.policy ?? policy,
    restrictions,
    evidence,
    nowMs: overrides.nowMs ?? 1000
  });
  return { result, restrictions, evidence };
}

test("matching wallet and available balances remain unrestricted", () => {
  const { result, restrictions } = run(new ScriptedSyntheticBalanceProvider([{ ...local }]));
  assert.equal(result.status, BalanceReconciliationStatus.MATCHED);
  assert.equal(restrictions.getActiveForAccount("account-1"), undefined);
});

test("wallet balance mismatch blocks new exposure", () => {
  const { result, restrictions } = run(new ScriptedSyntheticBalanceProvider([{ ...local, walletBalanceRaw: 999n }]));
  assert.equal(result.status, BalanceReconciliationStatus.MISMATCH);
  assert.equal(restrictions.getActiveForAccount("account-1").reason, OrderOperationalRestrictionReason.BALANCE_MISMATCH);
});

test("available balance mismatch blocks new exposure", () => {
  const { result } = run(new ScriptedSyntheticBalanceProvider([{ ...local, availableBalanceRaw: 799n }]));
  assert.equal(result.status, BalanceReconciliationStatus.MISMATCH);
  assert.equal(result.availableBalanceDifferenceRaw, 1n);
});

test("provider unavailable preserves uncertainty and blocks exposure", () => {
  const { result, restrictions } = run(new ScriptedSyntheticBalanceProvider([]));
  assert.equal(result.status, BalanceReconciliationStatus.PROVIDER_UNAVAILABLE);
  assert.equal(restrictions.getActiveForAccount("account-1").reason, OrderOperationalRestrictionReason.BALANCE_STATE_UNCERTAIN);
});

test("provider identity mismatch is rejected before evidence mutation", () => {
  const evidence = new Evidence();
  assert.throws(() => run({ getBalance: () => ({ ...local, accountId: "other" }) }, { evidence }), /identity mismatch/);
  assert.equal(evidence.records.size, 0);
});

test("available balance cannot exceed wallet balance", () => {
  assert.throws(() => run(new ScriptedSyntheticBalanceProvider([{ ...local }]), { local: { ...local, availableBalanceRaw: 1001n } }), /cannot exceed/);
});
