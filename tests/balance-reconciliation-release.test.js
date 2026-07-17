const test = require("node:test");
const assert = require("node:assert/strict");
const execution = require("../dist/apps/execution/src/index.js");

const {
  BalanceReconciliationStatus,
  BalanceReconciliationFreshnessStatus,
  InMemoryOrderOperationalRestrictionRepository,
  InMemoryOrderOperationalRestrictionReleaseEvidenceRepository,
  ScriptedSyntheticBalanceProvider,
  evaluateBalanceReconciliationFreshness,
  enforceBalanceReconciliationFreshness,
  reconcileBalance,
  releaseBalanceRestriction
} = execution;

class Evidence {
  constructor() { this.records = new Map(); }
  append(result) { if (this.records.has(result.reconciliationId)) throw new Error("duplicate"); this.records.set(result.reconciliationId, result); }
  getById(id) { return this.records.get(id); }
  getLatest(accountId, asset) { return [...this.records.values()].filter(r => r.accountId === accountId && r.asset === asset).sort((a,b) => b.observedAtMs - a.observedAtMs || b.reconciliationId.localeCompare(a.reconciliationId))[0]; }
}

const local = { accountId: "acct", asset: "USDT", walletBalanceRaw: 1000n, availableBalanceRaw: 800n, observedAtMs: 10 };
const policy = { walletBalanceToleranceRaw: 0n, availableBalanceToleranceRaw: 0n };

test("matched balance evidence becomes stale and activates a restriction", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const evidence = new Evidence();
  reconcileBalance({ reconciliationId: "bal-1", restrictionId: "unused", local, provider: new ScriptedSyntheticBalanceProvider([{...local, observedAtMs: 10}]), policy, restrictions, evidence, nowMs: 10 });
  assert.equal(evaluateBalanceReconciliationFreshness({ result: evidence.getById("bal-1"), nowMs: 20, warningAgeMs: 5, maximumAgeMs: 10 }), BalanceReconciliationFreshnessStatus.STALE);
  const restriction = enforceBalanceReconciliationFreshness({ restrictionId: "restrict-stale", local, evidence, restrictions, nowMs: 20, warningAgeMs: 5, maximumAgeMs: 10 });
  assert.equal(restriction.reason, "BALANCE_RECONCILIATION_STALE");
});

test("balance restriction requires a later same-account matched reconciliation and separated reviewers", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const evidence = new Evidence();
  const releases = new InMemoryOrderOperationalRestrictionReleaseEvidenceRepository();
  reconcileBalance({ reconciliationId: "bad", restrictionId: "restrict", local, provider: new ScriptedSyntheticBalanceProvider([{...local, walletBalanceRaw: 999n, observedAtMs: 10}]), policy, restrictions, evidence, nowMs: 10 });
  reconcileBalance({ reconciliationId: "good", restrictionId: "unused", local: {...local, observedAtMs: 20}, provider: new ScriptedSyntheticBalanceProvider([{...local, observedAtMs: 20}]), policy, restrictions, evidence, nowMs: 20 });
  assert.throws(() => releaseBalanceRestriction({ releaseId: "release-0", restrictionId: "restrict", matchedBalanceReconciliationId: "good", requestedBy: "same", verifiedBy: "same", rationale: "verified", nowMs: 21, restrictions, reconciliations: evidence, releaseEvidence: releases }), /different/);
  const released = releaseBalanceRestriction({ releaseId: "release-1", restrictionId: "restrict", matchedBalanceReconciliationId: "good", requestedBy: "operator", verifiedBy: "reviewer", rationale: "provider and local balances now match", nowMs: 21, restrictions, reconciliations: evidence, releaseEvidence: releases });
  assert.equal(released.status, "RELEASED");
  assert.equal(releases.getByRestrictionId("restrict").matchedBalanceReconciliationId, "good");
});

test("mismatch or cross-account evidence cannot release a balance restriction", () => {
  const restrictions = new InMemoryOrderOperationalRestrictionRepository();
  const evidence = new Evidence();
  const releases = new InMemoryOrderOperationalRestrictionReleaseEvidenceRepository();
  reconcileBalance({ reconciliationId: "bad", restrictionId: "restrict", local, provider: new ScriptedSyntheticBalanceProvider([{...local, walletBalanceRaw: 999n, observedAtMs: 10}]), policy, restrictions, evidence, nowMs: 10 });
  assert.equal(evidence.getById("bad").status, BalanceReconciliationStatus.MISMATCH);
  assert.throws(() => releaseBalanceRestriction({ releaseId: "release-2", restrictionId: "restrict", matchedBalanceReconciliationId: "bad", requestedBy: "operator", verifiedBy: "reviewer", rationale: "no", nowMs: 11, restrictions, reconciliations: evidence, releaseEvidence: releases }), /matched/);
});
