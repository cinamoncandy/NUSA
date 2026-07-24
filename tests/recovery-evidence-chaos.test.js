const test = require('node:test');
const assert = require('node:assert/strict');
const {
  runDisasterRecovery,
  RecoveryStepStatus,
  DisasterRecoveryDecision,
  evaluateStartupConsistency,
  StartupGateDecision,
  InMemoryRecoveryEvidenceRepository,
  DeterministicFaultInjector,
  FaultPoint,
  FaultAction,
  runChaosRecovery
} = require('../apps/execution/src/index');

test('recovery and startup evidence are append-only and causally linked', () => {
  const repository = new InMemoryRecoveryEvidenceRepository();
  const recovery = runDisasterRecovery({ runId: 'run-1', nowMs: 100, domains: [{ domain: 'orders', status: RecoveryStepStatus.PASS, checkpoint: 'c1', replayedEvents: 2 }] });
  repository.appendRecovery(recovery);
  assert.throws(() => repository.appendRecovery(recovery), /already exists/);
  const startup = evaluateStartupConsistency({ recovery, activeRestrictionCount: 0, unresolvedSubmissionCount: 0, clockSafe: true, websocketSynchronized: true, migrationStateKnown: true });
  repository.appendStartup({ auditId: 'audit-1', recoveryRunId: 'run-1', result: startup, evaluatedAtMs: 101 });
  assert.equal(repository.getStartup('audit-1').result.decision, StartupGateDecision.ALLOW_RESTRICTED_START);
  assert.throws(() => repository.appendStartup({ auditId: 'audit-2', recoveryRunId: 'missing', result: startup, evaluatedAtMs: 102 }), /does not exist/);
});

test('fault-injected unknown recovery state fails closed', () => {
  const injector = new DeterministicFaultInjector([{ scenarioId: 'unknown-orders', point: FaultPoint.BEFORE_REPLAY, action: FaultAction.RETURN_UNKNOWN, occurrence: 1 }]);
  const result = runChaosRecovery({ runId: 'chaos-1', nowMs: 100, injector, domains: [{ domain: 'orders', status: RecoveryStepStatus.PASS, checkpoint: 'c1', replayedEvents: 1 }] });
  assert.equal(result.recovery.decision, DisasterRecoveryDecision.SAFE_BLOCK);
  assert.deepEqual(result.recovery.blockingDomains, ['orders']);
  assert.equal(result.injections.length, 1);
});

test('fault-injected count corruption is rejected before a recovery result is issued', () => {
  const injector = new DeterministicFaultInjector([{ scenarioId: 'corrupt-count', point: FaultPoint.BEFORE_REPLAY, action: FaultAction.CORRUPT_COUNT, occurrence: 1 }]);
  assert.throws(() => runChaosRecovery({ runId: 'chaos-2', nowMs: 100, injector, domains: [{ domain: 'positions', status: RecoveryStepStatus.PASS, checkpoint: 'c1', replayedEvents: 1 }] }), /invalid recovery domain/);
});

test('throw faults are deterministic by point and occurrence', () => {
  const injector = new DeterministicFaultInjector([{ scenarioId: 'second-hit', point: FaultPoint.AFTER_CHECKPOINT, action: FaultAction.THROW, occurrence: 2 }]);
  assert.equal(injector.hit(FaultPoint.AFTER_CHECKPOINT), undefined);
  assert.throws(() => injector.hit(FaultPoint.AFTER_CHECKPOINT), /second-hit/);
});
