const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createLiveReadinessSourceProvider,
} = require('../dist/apps/cloud/src/liveReadinessSourceProvider.js');
const {
  collectLiveReadinessEvidence,
  LIVE_READINESS_SOURCE_IDS,
} = require('../dist/apps/cloud/src/liveReadinessEvidence.js');
const {
  createDormantLiveAuthority,
  evaluateLiveReadiness,
} = require('../dist/apps/cloud/src/liveReadinessGate.js');
const { startCloudRuntime } = require('../dist/apps/cloud/src/runtime.js');

const FIXED_NOW = '2026-08-24T00:00:00.000Z';
const OBSERVED_AT = '2026-08-23T23:59:00.000Z';
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

const observation = (value, freshness = 'FRESH') => Object.freeze({
  value,
  freshness,
  observedAt: OBSERVED_AT,
});

const greenReaders = () => ({
  currentHeadSha: () => 'head-123',
  paperAutoLearning: () => observation('STABLE'),
  shadowReplay: () => observation('VALID'),
  realAccountMonitor: () => observation('CONNECTED'),
  governance: () => observation('APPROVED'),
  tradePermission: () => observation('PERMIT'),
  riskAuthority: () => observation('HEALTHY'),
  reconciliationTests: () => observation('PASS'),
  killSwitchTests: () => observation('PASS'),
  idempotencyTests: () => observation('PASS'),
  exchangeFaultTests: () => observation('PASS'),
  workflows: () => observation({
    headSha: 'head-123',
    ci: 'PASS',
    mobileNative: 'PASS',
    restrictedLiveSafety: 'PASS',
    readOnlyBroker: 'PASS',
    aiZeroAuthority: 'PASS',
  }),
  prohibitedFinancialMutationScan: () => observation('ABSENT'),
  environmentFingerprint: () => observation('env-sha256:a'),
  accountFingerprint: () => observation('acct-sha256:b'),
  riskLimits: () => observation({
    maxNotionalPerOrder: 10000,
    maxDailyLoss: 5000,
    maxOpenExposure: 20000,
    maxConcurrentPositions: 1,
    maxSlippageBps: 30,
    maxOrdersPerMinute: 2,
    marketAllowlist: ['KRW-BTC'],
  }),
  runtimeSafety: () => observation(healthyRuntime),
  authority: () => observation(createDormantLiveAuthority()),
  activationState: () => observation('READY_FOR_MANUAL_ENABLE'),
  activationLeaseState: () => observation('ABSENT'),
});

const makeProvider = (readers = greenReaders()) => createLiveReadinessSourceProvider({
  now: () => FIXED_NOW,
  sourceVersion: 'live-readiness-source-test-v1',
  readers,
});

test('production provider normalizes canonical inputs and existing gate remains authoritative', () => {
  const snapshot = makeProvider().getSnapshot();
  const evidence = collectLiveReadinessEvidence(snapshot);
  const result = evaluateLiveReadiness(evidence, snapshot.runtimeSafety, snapshot.authority, FIXED_NOW);

  assert.equal(result.status, 'READY_FOR_MANUAL_ENABLE');
  assert.deepEqual(result.blockers, []);
  assert.equal(result.authority.liveAuthority, 'NONE');
  assert.equal(result.authority.productionMutationAllowed, false);
  assert.equal(snapshot.activationState, 'READY_FOR_MANUAL_ENABLE');
  assert.equal(snapshot.activationLeaseState, 'ABSENT');
  assert.equal(evidence.sourceEvidenceAvailable, true);
  assert.deepEqual(snapshot.freshness, Object.fromEntries(LIVE_READINESS_SOURCE_IDS.map((sourceId) => [sourceId, 'FRESH'])));
});

test('provider output is deterministic, provenance-bearing, ordered, and immutable', () => {
  const first = makeProvider().getSnapshot();
  const second = makeProvider().getSnapshot();

  assert.deepEqual(first, second);
  assert.equal(first.provenance.generatedAt, FIXED_NOW);
  assert.match(first.provenance.sourceFingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(first.provenance.inputs.map((input) => input.sourceId), [...first.provenance.inputs].map((input) => input.sourceId).sort());
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.provenance), true);
  assert.equal(Object.isFrozen(first.provenance.inputs), true);
  assert.equal(Object.isFrozen(first.runtimeSafety), true);
  assert.equal(Object.isFrozen(first.riskLimits.marketAllowlist), true);
});

test('missing or stale production evidence remains unknown and fails closed', () => {
  const readers = greenReaders();
  delete readers.governance;
  readers.shadowReplay = () => observation('VALID', 'STALE');
  const snapshot = makeProvider(readers).getSnapshot();
  const evidence = collectLiveReadinessEvidence(snapshot);
  const result = evaluateLiveReadiness(evidence, snapshot.runtimeSafety, snapshot.authority, FIXED_NOW);

  assert.equal(snapshot.governance, 'UNKNOWN');
  assert.equal(snapshot.freshness.governance, 'UNKNOWN');
  assert.equal(snapshot.freshness.shadowReplay, 'STALE');
  assert.equal(evidence.sourceEvidenceAvailable, false);
  assert.equal(result.status, 'NOT_READY');
  assert.ok(result.blockers.includes('GOVERNANCE_NOT_APPROVED'));
  assert.ok(result.blockers.includes('SOURCE_EVIDENCE_INCOMPLETE'));
});

test('no-reader production source does not turn missing inputs into readiness', () => {
  const snapshot = createLiveReadinessSourceProvider({ now: () => FIXED_NOW, sourceVersion: 'no-reader-test' }).getSnapshot();
  const evidence = collectLiveReadinessEvidence(snapshot);
  const result = evaluateLiveReadiness(evidence, snapshot.runtimeSafety, snapshot.authority, FIXED_NOW);

  assert.equal(snapshot.paperAutoLearning, 'UNKNOWN');
  assert.equal(snapshot.shadowReplay, 'MISSING');
  assert.equal(snapshot.realAccountMonitor, 'UNKNOWN');
  assert.equal(evidence.sourceEvidenceAvailable, false);
  assert.equal(result.status, 'NOT_READY');
  assert.ok(result.blockers.includes('PAPER_AUTO_LEARNING_NOT_STABLE'));
  assert.ok(result.blockers.includes('RISK_LIMITS_MISSING'));
});

test('forbidden source references are redacted and unexpected LIVE authority is rejected', () => {
  const readers = greenReaders();
  const forbiddenKey = ['Auth', 'orization'].join('');
  readers.environmentFingerprint = () => observation(`${forbiddenKey}: hidden`);
  const snapshot = makeProvider(readers).getSnapshot();
  assert.equal(snapshot.environmentFingerprint, '');
  assert.doesNotMatch(JSON.stringify(snapshot), /Authorization|hidden/);

  const unsafeReaders = greenReaders();
  unsafeReaders.authority = () => observation({ liveAuthority: 'BOUNDED_LIVE', productionMutationAllowed: true });
  assert.throws(() => makeProvider(unsafeReaders).getSnapshot(), /unexpected LIVE authority/);
});

test('provider reads are idempotent and do not mutate canonical readers', () => {
  let calls = 0;
  const readers = greenReaders();
  const original = readers.governance;
  readers.governance = () => {
    calls += 1;
    return original();
  };
  const provider = makeProvider(readers);
  const first = provider.getSnapshot();
  const second = provider.getSnapshot();

  assert.equal(calls, 2);
  assert.equal(first.provenance.sourceFingerprint, second.provenance.sourceFingerprint);
  assert.equal(first.authority.productionMutationAllowed, false);
});

test('production Cloud runtime wires a read-only source accessor', async () => {
  const dashboardToken = ['runtime', 'source', 'provider', 'test', 'credential'].join('-');
  const handle = startCloudRuntime({
    NUSA_CLOUD_DASHBOARD_PORT: '42071',
    NUSA_CLOUD_DASHBOARD_TOKEN: dashboardToken,
  });
  try {
    const snapshot = handle.getLiveReadinessSourceSnapshot();
    assert.equal(typeof handle.getLiveReadinessSourceSnapshot, 'function');
    assert.equal(snapshot.authority.liveAuthority, 'NONE');
    assert.equal(snapshot.authority.productionMutationAllowed, false);
    assert.equal(snapshot.activationLeaseState, 'UNKNOWN');
    assert.equal(snapshot.provenance.sourceVersion, 'unknown');
    assert.equal(collectLiveReadinessEvidence(snapshot).sourceEvidenceAvailable, false);
  } finally {
    await handle.stop();
  }
});
