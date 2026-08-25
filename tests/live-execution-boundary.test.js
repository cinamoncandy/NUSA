const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LiveExecutionBoundary,
  LiveExecutionBlockedError,
} = require('../dist/apps/cloud/src/liveExecutionBoundary.js');

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

const dormantAuthority = Object.freeze({
  liveAuthority: 'NONE',
  productionMutationAllowed: false,
});

const liveAuthority = Object.freeze({
  liveAuthority: 'BOUNDED_LIVE',
  productionMutationAllowed: true,
  activationLease: Object.freeze({
    leaseId: 'lease-1',
    ownerPrincipalId: 'owner',
    environmentFingerprint: 'env-sha256:a',
    accountFingerprint: 'acct-sha256:b',
    issuedAt: '2026-08-22T07:59:00.000Z',
    expiresAt: '2026-08-22T08:05:00.000Z',
    explicitHumanConfirmation: true,
  }),
});

const context = (overrides = {}) => ({
  evidence: evidence(),
  runtime: healthyRuntime,
  authority: dormantAuthority,
  exposure: {
    dailyLoss: 0,
    openExposure: 0,
    concurrentPositions: 0,
    ordersLastMinute: 0,
  },
  nowIso: '2026-08-22T08:00:00.000Z',
  ...overrides,
});

const order = (overrides = {}) => ({
  idempotencyKey: 'idem-1',
  decisionId: 'decision-1',
  strategyVersion: 'strategy-v1',
  inputSnapshotHash: 'sha256:input',
  market: 'KRW-BTC',
  side: 'BUY',
  orderType: 'LIMIT',
  quantity: 0.001,
  expectedNotional: 1000,
  expectedSlippageBps: 10,
  limitPrice: 1000000,
  ...overrides,
});

function harness() {
  const calls = { place: 0, cancel: 0 };
  const events = [];
  const keys = new Set();
  const broker = {
    async placeOrder() {
      calls.place += 1;
      return { brokerOrderId: 'broker-1', acceptedAt: '2026-08-22T08:00:00.000Z' };
    },
    async cancelOrder(intent) {
      calls.cancel += 1;
      return { brokerOrderId: intent.brokerOrderId, cancelledAt: '2026-08-22T08:00:01.000Z' };
    },
  };
  const journal = {
    async reserveIdempotencyKey(key) {
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    },
    async append(event) {
      events.push(event);
    },
  };
  return { boundary: new LiveExecutionBoundary(broker, journal), calls, events };
}

test('dormant authority blocks before broker mutation', async () => {
  const { boundary, calls, events } = harness();
  await assert.rejects(
    boundary.placeOrder(context(), order()),
    (error) => error instanceof LiveExecutionBlockedError && error.blockers.includes('READINESS_READY_FOR_MANUAL_ENABLE'),
  );
  assert.equal(calls.place, 0);
  assert.equal(events.at(-1).kind, 'BLOCKED');
});

test('fresh explicit bounded authority can cross the boundary only within configured limits', async () => {
  const { boundary, calls, events } = harness();
  const receipt = await boundary.placeOrder(context({ authority: liveAuthority }), order());
  assert.equal(receipt.brokerOrderId, 'broker-1');
  assert.equal(calls.place, 1);
  assert.deepEqual(events.map((event) => event.kind), ['ORDER_SUBMIT', 'ORDER_ACK']);
});

test('risk limits and runtime circuit breakers fail closed before broker mutation', async () => {
  const first = harness();
  await assert.rejects(
    first.boundary.placeOrder(context({ authority: liveAuthority }), order({ expectedNotional: 10001 })),
    (error) => error.blockers.includes('MAX_NOTIONAL_EXCEEDED'),
  );
  assert.equal(first.calls.place, 0);

  const second = harness();
  await assert.rejects(
    second.boundary.placeOrder(
      context({ authority: liveAuthority, runtime: { ...healthyRuntime, reconciliationMismatch: true } }),
      order(),
    ),
    (error) => error.blockers.includes('RECONCILIATION_MISMATCH'),
  );
  assert.equal(second.calls.place, 0);
});

test('durable idempotency reservation suppresses duplicate order dispatch', async () => {
  const { boundary, calls, events } = harness();
  const live = context({ authority: liveAuthority });
  await boundary.placeOrder(live, order());
  await assert.rejects(
    boundary.placeOrder(live, order()),
    (error) => error.blockers.includes('DUPLICATE_IDEMPOTENCY_KEY'),
  );
  assert.equal(calls.place, 1);
  assert.equal(events.at(-1).kind, 'BLOCKED');
});

test('cancel is gated by the same fresh bounded authority and there is no withdrawal/transfer surface', async () => {
  const { boundary, calls } = harness();
  const cancel = {
    idempotencyKey: 'cancel-1',
    decisionId: 'decision-1',
    market: 'KRW-BTC',
    brokerOrderId: 'broker-1',
  };

  await assert.rejects(boundary.cancelOrder(context(), cancel), LiveExecutionBlockedError);
  assert.equal(calls.cancel, 0);

  const receipt = await boundary.cancelOrder(context({ authority: liveAuthority }), cancel);
  assert.equal(receipt.brokerOrderId, 'broker-1');
  assert.equal(calls.cancel, 1);
  assert.equal(boundary.withdraw, undefined);
  assert.equal(boundary.transfer, undefined);
});
