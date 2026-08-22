const test = require('node:test');
const assert = require('node:assert/strict');
const { collectLiveReadinessEvidence } = require('../dist/apps/cloud/src/liveReadinessEvidence.js');
const { createDormantLiveAuthority, evaluateLiveReadiness } = require('../dist/apps/cloud/src/liveReadinessGate.js');

const healthyRuntime = Object.freeze({
  killSwitchActive: false,
  staleMarketData: false,
  reconciliationMismatch: false,
  exchangeError: false,
  abnormalBalanceDrift: false,
  riskBudgetBreached: false,
  strategyInvalidated: false,
  latencyOrSlippageBreached: false,
});

const greenSnapshot = (overrides = {}) => ({
  currentHeadSha: 'head-123',
  paperAutoLearning: 'STABLE',
  shadowReplay: 'VALID',
  realAccountMonitor: 'CONNECTED',
  governance: 'APPROVED',
  tradePermission: 'PERMIT',
  riskAuthority: 'HEALTHY',
  reconciliationTests: 'PASS',
  killSwitchTests: 'PASS',
  idempotencyTests: 'PASS',
  exchangeFaultTests: 'PASS',
  workflows: {
    headSha: 'head-123',
    ci: 'PASS',
    mobileNative: 'PASS',
    restrictedLiveSafety: 'PASS',
    readOnlyBroker: 'PASS',
    aiZeroAuthority: 'PASS',
  },
  prohibitedFinancialMutationScan: 'ABSENT',
  environmentFingerprint: 'env-sha256:a',
  accountFingerprint: 'acct-sha256:b',
  riskLimits: {
    maxNotionalPerOrder: 10000,
    maxDailyLoss: 5000,
    maxOpenExposure: 20000,
    maxConcurrentPositions: 1,
    maxSlippageBps: 30,
    maxOrdersPerMinute: 2,
    marketAllowlist: ['KRW-BTC'],
  },
  ...overrides,
});

test('all non-owner prerequisites auto-pass from objective green evidence', () => {
  const evidence = collectLiveReadinessEvidence(greenSnapshot());
  assert.equal(evidence.paperAutoLearningStable, true);
  assert.equal(evidence.realAccountReadOnlyHealthy, true);
  assert.equal(evidence.requiredCiPasses, true);
  const result = evaluateLiveReadiness(evidence, healthyRuntime, createDormantLiveAuthority(), '2026-08-22T09:00:00.000Z');
  assert.equal(result.status, 'READY_FOR_MANUAL_ENABLE');
  assert.deepEqual(result.blockers, []);
  assert.equal(result.authority.liveAuthority, 'NONE');
  assert.equal(result.authority.productionMutationAllowed, false);
});

test('a previously green prerequisite automatically revokes readiness on recomputation', () => {
  const first = evaluateLiveReadiness(collectLiveReadinessEvidence(greenSnapshot()), healthyRuntime);
  assert.equal(first.status, 'READY_FOR_MANUAL_ENABLE');
  const regressed = evaluateLiveReadiness(collectLiveReadinessEvidence(greenSnapshot({ realAccountMonitor: 'STALE' })), healthyRuntime);
  assert.equal(regressed.status, 'NOT_READY');
  assert.ok(regressed.blockers.includes('REAL_ACCOUNT_READ_ONLY_UNHEALTHY'));
});

test('required workflows only pass when every required workflow is green on the exact current head', () => {
  const wrongHead = collectLiveReadinessEvidence(greenSnapshot({ workflows: { ...greenSnapshot().workflows, headSha: 'older-head' } }));
  assert.equal(wrongHead.requiredCiPasses, false);
  const failedMobile = collectLiveReadinessEvidence(greenSnapshot({ workflows: { ...greenSnapshot().workflows, mobileNative: 'FAIL' } }));
  assert.equal(failedMobile.requiredCiPasses, false);
});

test('unknown or failing machine evidence never auto-passes', () => {
  const evidence = collectLiveReadinessEvidence(greenSnapshot({ governance: 'UNKNOWN', prohibitedFinancialMutationScan: 'UNKNOWN' }));
  assert.equal(evidence.governanceApproved, false);
  assert.equal(evidence.noWithdrawalOrTransferPath, false);
});
