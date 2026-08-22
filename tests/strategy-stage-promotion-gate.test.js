const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateVenueConformance } = require('../scripts/venue-conformance-harness');
const { evaluateStrategyStagePromotion } = require('../scripts/strategy-stage-promotion-gate');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baselineConformanceInput() {
  return {
    strategy: {
      schemaVersion: 1,
      id: 'strategy-baseline-v1',
      instrument: 'TEST-FUT',
      orderTypes: ['MARKET', 'LIMIT'],
      requiresOvernight: false,
      requiresWeekend: false,
      maxOrderNotional: 1000,
      maxPositionNotional: 3000,
      maxDailyLoss: 250,
      maxTrailingDrawdown: 700,
      tradesDuringRestrictedNews: false,
      requiresMargin: true,
      maxLeverage: 2,
      tradingWindows: [
        { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], start: '10:00', end: '15:00', timezone: 'UTC' },
      ],
    },
    venue: {
      schemaVersion: 1,
      id: 'synthetic-venue-v1',
      tradingEnabled: true,
      supportedInstruments: ['TEST-FUT'],
      supportedOrderTypes: ['MARKET', 'LIMIT'],
      allowsOvernight: true,
      allowsWeekend: false,
      maxOrderNotional: 5000,
      maxPositionNotional: 10000,
      marginAllowed: true,
      maxLeverage: 5,
      tradingWindows: [
        { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], start: '09:30', end: '16:00', timezone: 'UTC' },
      ],
    },
    account: {
      schemaVersion: 1,
      id: 'synthetic-account-v1',
      status: 'ACTIVE',
      allowedInstruments: ['TEST-FUT'],
      allowsOvernight: false,
      allowsWeekend: false,
      maxOrderNotional: 2000,
      maxPositionNotional: 5000,
      dailyLossLimit: 500,
      trailingDrawdownLimit: 1000,
      newsTradingAllowed: false,
      marginAllowed: true,
      maxLeverage: 3,
      tradingWindows: null,
    },
  };
}

function requestForInput(conformanceInput, fromStage = 'PAPER', toStage = 'SHADOW') {
  const conformance = evaluateVenueConformance(conformanceInput);
  return {
    schemaVersion: 1,
    promotionId: 'promotion-test-1',
    strategyId: conformance.strategyId,
    strategyHash: conformance.binding.strategyHash,
    venuePolicyHash: conformance.binding.venuePolicyHash,
    accountPolicyHash: conformance.binding.accountPolicyHash,
    fromStage,
    toStage,
    conformanceInput: clone(conformanceInput),
    venueConformance: conformance,
  };
}

function promotionRequest(fromStage = 'PAPER', toStage = 'SHADOW') {
  return requestForInput(baselineConformanceInput(), fromStage, toStage);
}

test('PAPER to SHADOW requires exact recomputed PASS venue conformance', () => {
  const result = evaluateStrategyStagePromotion(promotionRequest());
  assert.equal(result.status, 'PASS');
  assert.equal(result.eligible, true);
  assert.equal(result.mutationAuthorized, false);
  assert.equal(result.liveAuthority, 'NONE');
});

test('SHADOW to RESTRICTED_LIVE uses the same fail-closed venue gate', () => {
  const result = evaluateStrategyStagePromotion(promotionRequest('SHADOW', 'RESTRICTED_LIVE'));
  assert.equal(result.status, 'PASS');
  assert.equal(result.eligible, true);
  assert.equal(result.mutationAuthorized, false);
});

test('explicit venue BLOCK prevents promotion', () => {
  const input = baselineConformanceInput();
  input.strategy.requiresOvernight = true;
  const request = requestForInput(input);

  const result = evaluateStrategyStagePromotion(request);
  assert.equal(result.status, 'BLOCK');
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('VENUE_CONFORMANCE_BLOCKED'));
});

test('missing evidence or current conformance input never auto-passes', () => {
  const missingEvidence = promotionRequest();
  delete missingEvidence.venueConformance;
  let result = evaluateStrategyStagePromotion(missingEvidence);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.eligible, false);

  const missingCurrentInput = promotionRequest();
  delete missingCurrentInput.conformanceInput;
  result = evaluateStrategyStagePromotion(missingCurrentInput);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('CURRENT_CONFORMANCE_INPUT_MISSING'));
});

test('UNKNOWN recomputed conformance never auto-passes', () => {
  const input = baselineConformanceInput();
  delete input.account.dailyLossLimit;
  const result = evaluateStrategyStagePromotion(requestForInput(input));
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes('VENUE_CONFORMANCE_NOT_PASS'));
});

test('changed strategy hash cannot reuse current conformance', () => {
  const request = promotionRequest();
  request.strategyHash = `sha256:${'f'.repeat(64)}`;
  const result = evaluateStrategyStagePromotion(request);
  assert.equal(result.status, 'BLOCK');
  assert.ok(result.reasons.includes('CURRENT_STRATEGY_HASH_MISMATCH'));
});

test('changed venue or account policy hash is blocked', () => {
  const venueChanged = promotionRequest();
  venueChanged.venuePolicyHash = `sha256:${'a'.repeat(64)}`;
  let result = evaluateStrategyStagePromotion(venueChanged);
  assert.equal(result.status, 'BLOCK');
  assert.ok(result.reasons.includes('CURRENT_VENUE_POLICY_HASH_MISMATCH'));

  const accountChanged = promotionRequest();
  accountChanged.accountPolicyHash = `sha256:${'b'.repeat(64)}`;
  result = evaluateStrategyStagePromotion(accountChanged);
  assert.equal(result.status, 'BLOCK');
  assert.ok(result.reasons.includes('CURRENT_ACCOUNT_POLICY_HASH_MISMATCH'));
});

test('old PASS evidence cannot survive a current strategy change', () => {
  const request = promotionRequest();
  request.conformanceInput.strategy.maxLeverage = 2.5;
  const current = evaluateVenueConformance(request.conformanceInput);
  request.strategyHash = current.binding.strategyHash;
  request.venuePolicyHash = current.binding.venuePolicyHash;
  request.accountPolicyHash = current.binding.accountPolicyHash;

  const result = evaluateStrategyStagePromotion(request);
  assert.equal(result.status, 'BLOCK');
  assert.ok(result.reasons.includes('VENUE_CONFORMANCE_EVIDENCE_STALE_OR_TAMPERED'));
});

test('forged PASS evidence is rejected by canonical recomputation', () => {
  const request = promotionRequest();
  request.venueConformance = {
    ...request.venueConformance,
    checks: request.venueConformance.checks.map((check) => ({ ...check })),
    reasons: [],
    forged: true,
  };
  const result = evaluateStrategyStagePromotion(request);
  assert.equal(result.status, 'BLOCK');
  assert.ok(result.reasons.includes('VENUE_CONFORMANCE_EVIDENCE_STALE_OR_TAMPERED'));
});

test('unsupported transitions are invalid and never mutate state', () => {
  const request = promotionRequest('RESEARCH', 'LIVE');
  const result = evaluateStrategyStagePromotion(request);
  assert.equal(result.status, 'INVALID');
  assert.equal(result.eligible, false);
  assert.equal(result.mutationAuthorized, false);
  assert.equal(result.liveAuthority, 'NONE');
});
