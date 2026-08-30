const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeStrategyEvolutionLedgerEntrySha256,
  replayStrategyEvolutionLedger,
} = require('../dist/apps/cloud/src/strategyEvolutionLedger.js');

const H = 'a'.repeat(64);
const D = 'b'.repeat(64);
const P = 'c'.repeat(64);
const E1 = 'd'.repeat(64);
const E2 = 'e'.repeat(64);

function event(overrides = {}) {
  const unsigned = {
    eventId: 'event-0',
    sequence: 0,
    candidateId: 'candidate-1',
    strategyFamilyId: 'family-1',
    regime: 'TREND',
    candidateVersion: 'v1',
    codeSha: 'deadbeef',
    datasetFingerprintSha256: D,
    parameterFingerprintSha256: P,
    parentLineageId: null,
    evidenceKind: 'PAPER_OUTCOME',
    evidenceFingerprintSha256: E1,
    independentEvidenceId: 'independent-1',
    decision: 'HOLD',
    occurredAt: '2026-08-30T08:00:00.000Z',
    previousEntrySha256: null,
    liveAuthority: 'NONE',
    productionMutationAllowed: false,
    aiAuthority: 'ZERO_AUTHORITY',
    ...overrides,
  };
  return { ...unsigned, entrySha256: computeStrategyEvolutionLedgerEntrySha256(unsigned) };
}

test('replays identical immutable ledger deterministically', () => {
  const first = event();
  const second = event({
    eventId: 'event-1', sequence: 1, evidenceFingerprintSha256: E2,
    independentEvidenceId: 'independent-2', decision: 'DEMOTE', previousEntrySha256: first.entrySha256,
  });
  const input = { candidateId: 'candidate-1', strategyFamilyId: 'family-1', regime: 'TREND', events: [first, second] };
  const a = replayStrategyEvolutionLedger(input);
  const b = replayStrategyEvolutionLedger(input);
  assert.deepEqual(a, b);
  assert.equal(a.accepted, true);
  assert.equal(a.lastEntrySha256, second.entrySha256);
  assert.equal(a.decisions.DEMOTE, 1);
});

test('fails closed on duplicate evidence and independent evidence reuse', () => {
  const first = event();
  const second = event({ eventId: 'event-1', sequence: 1, previousEntrySha256: first.entrySha256 });
  const result = replayStrategyEvolutionLedger({ candidateId: 'candidate-1', strategyFamilyId: 'family-1', regime: 'TREND', events: [first, second] });
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes('DUPLICATE_OR_REPLAYED_EVENT'));
  assert.ok(result.reasons.includes('NON_INDEPENDENT_EVIDENCE_REUSE'));
});

test('fails closed on out-of-order or broken hash chain', () => {
  const first = event();
  const second = event({ eventId: 'event-1', sequence: 2, evidenceFingerprintSha256: E2, independentEvidenceId: 'independent-2', previousEntrySha256: H });
  const result = replayStrategyEvolutionLedger({ candidateId: 'candidate-1', strategyFamilyId: 'family-1', regime: 'TREND', events: [first, second] });
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes('OUT_OF_ORDER_SEQUENCE'));
  assert.ok(result.reasons.includes('BROKEN_HASH_CHAIN'));
});

test('fails closed on identity mismatch and tampering', () => {
  const first = event();
  const tampered = { ...first, regime: 'RANGE' };
  const result = replayStrategyEvolutionLedger({ candidateId: 'candidate-1', strategyFamilyId: 'family-1', regime: 'TREND', events: [tampered] });
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes('IDENTITY_MISMATCH'));
  assert.ok(result.reasons.includes('ENTRY_FINGERPRINT_MISMATCH'));
});

test('counterfactual evidence can never promote', () => {
  const first = event({ evidenceKind: 'COUNTERFACTUAL', decision: 'PROMOTE' });
  const result = replayStrategyEvolutionLedger({ candidateId: 'candidate-1', strategyFamilyId: 'family-1', regime: 'TREND', events: [first] });
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes('COUNTERFACTUAL_CANNOT_PROMOTE'));
});

test('rejects authority expansion', () => {
  const first = event();
  assert.throws(() => replayStrategyEvolutionLedger({ candidateId: 'candidate-1', strategyFamilyId: 'family-1', regime: 'TREND', events: [{ ...first, liveAuthority: 'LIVE' }] }), /authority invariant/);
});
