const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateVenueConformance } = require('../scripts/venue-conformance-harness');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseline() {
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
      supportedInstruments: ['TEST-FUT', 'TEST-SPOT'],
      supportedOrderTypes: ['MARKET', 'LIMIT', 'STOP'],
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

test('fully conformant strategy is deployable', () => {
  const result = evaluateVenueConformance(baseline());
  assert.equal(result.status, 'PASS');
  assert.equal(result.deployable, true);
  assert.deepEqual(result.reasons, []);
});

test('unsupported instrument blocks deployment', () => {
  const input = baseline();
  input.strategy.instrument = 'OTHER-FUT';
  const result = evaluateVenueConformance(input);
  assert.equal(result.status, 'BLOCK');
  assert.ok(result.reasons.includes('VENUE_INSTRUMENT_UNSUPPORTED'));
});

test('account overnight restriction blocks an overnight strategy', () => {
  const input = baseline();
  input.strategy.requiresOvernight = true;
  const result = evaluateVenueConformance(input);
  assert.equal(result.status, 'BLOCK');
  assert.ok(result.reasons.includes('OVERNIGHT_NOT_ALLOWED'));
});

test('order, position, daily-loss, and trailing-drawdown limits are hard deployability gates', () => {
  const input = baseline();
  input.strategy.maxOrderNotional = 2500;
  input.strategy.maxPositionNotional = 6000;
  input.strategy.maxDailyLoss = 600;
  input.strategy.maxTrailingDrawdown = 1200;
  const result = evaluateVenueConformance(input);
  assert.equal(result.status, 'BLOCK');
  assert.ok(result.reasons.includes('MAX_ORDER_NOTIONAL_EXCEEDED'));
  assert.ok(result.reasons.includes('MAX_POSITION_NOTIONAL_EXCEEDED'));
  assert.ok(result.reasons.includes('ACCOUNT_DAILY_LOSS_CONFLICT'));
  assert.ok(result.reasons.includes('TRAILING_DRAWDOWN_CONFLICT'));
});

test('order type, news, margin, and leverage conflicts block deployment', () => {
  const input = baseline();
  input.strategy.orderTypes.push('ICEBERG');
  input.strategy.tradesDuringRestrictedNews = true;
  input.account.marginAllowed = false;
  input.strategy.maxLeverage = 4;
  const result = evaluateVenueConformance(input);
  assert.equal(result.status, 'BLOCK');
  assert.ok(result.reasons.includes('VENUE_ORDER_TYPE_UNSUPPORTED'));
  assert.ok(result.reasons.includes('NEWS_TRADING_RESTRICTION_CONFLICT'));
  assert.ok(result.reasons.includes('MARGIN_NOT_ALLOWED'));
  assert.ok(result.reasons.includes('LEVERAGE_LIMIT_EXCEEDED'));
});

test('strategy trading hours must fit both venue and account windows', () => {
  const venueConflict = baseline();
  venueConflict.strategy.tradingWindows[0].end = '17:00';
  let result = evaluateVenueConformance(venueConflict);
  assert.equal(result.status, 'BLOCK');
  assert.ok(result.reasons.includes('VENUE_TRADING_HOURS_CONFLICT'));

  const accountConflict = baseline();
  accountConflict.account.tradingWindows = [
    { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], start: '11:00', end: '14:00', timezone: 'UTC' },
  ];
  result = evaluateVenueConformance(accountConflict);
  assert.equal(result.status, 'BLOCK');
  assert.ok(result.reasons.includes('ACCOUNT_TRADING_HOURS_CONFLICT'));
});

test('missing deployability policy remains UNKNOWN and never auto-passes', () => {
  const input = baseline();
  delete input.account.dailyLossLimit;
  const result = evaluateVenueConformance(input);
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.deployable, false);
  assert.ok(result.reasons.includes('DAILY_LOSS_POLICY_UNKNOWN'));
});

test('read-only or otherwise non-active account cannot be treated as deployable', () => {
  const input = baseline();
  input.account.status = 'READ_ONLY';
  const result = evaluateVenueConformance(input);
  assert.equal(result.status, 'BLOCK');
  assert.ok(result.reasons.includes('ACCOUNT_TRADING_NOT_ACTIVE'));
});

test('a hard policy conflict dominates unrelated UNKNOWN evidence', () => {
  const input = baseline();
  input.strategy.instrument = 'OTHER-FUT';
  delete input.account.dailyLossLimit;
  const result = evaluateVenueConformance(input);
  assert.equal(result.status, 'BLOCK');
  assert.equal(result.deployable, false);
  assert.ok(result.reasons.includes('VENUE_INSTRUMENT_UNSUPPORTED'));
  assert.ok(result.reasons.includes('DAILY_LOSS_POLICY_UNKNOWN'));
});

test('input objects are not mutated by conformance evaluation', () => {
  const input = baseline();
  const before = clone(input);
  evaluateVenueConformance(input);
  assert.deepEqual(input, before);
});

test('conformance result is bound to exact strategy, venue policy, and account policy', () => {
  const input = baseline();
  const result = evaluateVenueConformance(input);
  assert.match(result.binding.strategyHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(result.binding.venuePolicyHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(result.binding.accountPolicyHash, /^sha256:[0-9a-f]{64}$/);

  const repeat = evaluateVenueConformance(clone(input));
  assert.deepEqual(repeat.binding, result.binding);
});

test('any strategy or policy change invalidates the corresponding conformance binding', () => {
  const original = baseline();
  const originalResult = evaluateVenueConformance(original);

  const strategyChanged = baseline();
  strategyChanged.strategy.maxLeverage = 2.5;
  assert.notEqual(evaluateVenueConformance(strategyChanged).binding.strategyHash, originalResult.binding.strategyHash);

  const venueChanged = baseline();
  venueChanged.venue.maxLeverage = 4;
  assert.notEqual(evaluateVenueConformance(venueChanged).binding.venuePolicyHash, originalResult.binding.venuePolicyHash);

  const accountChanged = baseline();
  accountChanged.account.dailyLossLimit = 450;
  assert.notEqual(evaluateVenueConformance(accountChanged).binding.accountPolicyHash, originalResult.binding.accountPolicyHash);
});
