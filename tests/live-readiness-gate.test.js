const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDormantLiveAuthority,
  evaluateLiveReadiness,
  isLiveActivationLeaseValid,
} = require('../dist/apps/cloud/src/liveReadinessGate.js');

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

const evidence = (overrides = {}) => ({
  paperAutoLearningStable: true,
  shadowReplayEvidenceValid: true,
  realAccountReadOnlyHealthy: true,
  governanceApproved: true,
  tradePermissionPasses: true,
  riskAuthorityHealthy: true,
  reconciliationTestsPass: true,
  killSwitchTestsPass: true,
  idempotencyTestsPass: true,
  exchangeFaultTestsPass: true,
  requiredCiPasses: true,
  noWithdrawalOrTransferPath: true,
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

test('green evidence remains dormant and only becomes ready for manual enable', () => {
  const result = evaluateLiveReadiness(evidence(), healthyRuntime, createDormantLiveAuthority(), '2026-08-22T08:00:00.000Z');
  assert.equal(result.status, 'READY_FOR_MANUAL_ENABLE');
  assert.equal(result.authority.liveAuthority, 'NONE');
  assert.equal(result.authority.productionMutationAllowed, false);
  assert.deepEqual(result.blockers, []);
});

test('missing prerequisite fails closed', () => {
  const result = evaluateLiveReadiness(evidence({ paperAutoLearningStable: false }), healthyRuntime);
  assert.equal(result.status, 'NOT_READY');
  assert.ok(result.blockers.includes('PAPER_AUTO_LEARNING_NOT_STABLE'));
});

test('runtime circuit breaker forces HALTED', () => {
  const result = evaluateLiveReadiness(evidence(), { ...healthyRuntime, reconciliationMismatch: true });
  assert.equal(result.status, 'HALTED');
  assert.ok(result.blockers.includes('RECONCILIATION_MISMATCH'));
});

test('bounded LIVE authority requires a fresh human lease pinned to environment and account', () => {
  const lease = {
    leaseId: 'lease-1',
    ownerPrincipalId: 'owner',
    environmentFingerprint: 'env-sha256:a',
    accountFingerprint: 'acct-sha256:b',
    issuedAt: '2026-08-22T07:59:00.000Z',
    expiresAt: '2026-08-22T08:05:00.000Z',
    explicitHumanConfirmation: true,
  };
  assert.equal(isLiveActivationLeaseValid(lease, evidence(), '2026-08-22T08:00:00.000Z'), true);
  const enabled = evaluateLiveReadiness(evidence(), healthyRuntime, {
    liveAuthority: 'BOUNDED_LIVE',
    productionMutationAllowed: true,
    activationLease: lease,
  }, '2026-08-22T08:00:00.000Z');
  assert.equal(enabled.status, 'ENABLED');

  const expired = evaluateLiveReadiness(evidence(), healthyRuntime, {
    liveAuthority: 'BOUNDED_LIVE',
    productionMutationAllowed: true,
    activationLease: lease,
  }, '2026-08-22T08:06:00.000Z');
  assert.equal(expired.status, 'NOT_READY');
  assert.ok(expired.blockers.includes('ACTIVATION_LEASE_INVALID_OR_EXPIRED'));
});

test('withdrawal or transfer capability blocks readiness', () => {
  const result = evaluateLiveReadiness(evidence({ noWithdrawalOrTransferPath: false }), healthyRuntime);
  assert.equal(result.status, 'NOT_READY');
  assert.ok(result.blockers.includes('WITHDRAWAL_OR_TRANSFER_PATH_PRESENT'));
});
