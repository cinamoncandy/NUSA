const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveSpotPerpPair,
  scanFundingCarry,
  evaluateDeltaNeutralState,
  decideFundingCarryExit
} = require('../dist/apps/cloud/src/fundingCarryEngine.js');

const instruments = [
  { venue: 'HL', symbol: 'UBTC', baseAsset: 'BTC', quoteAsset: 'USDC', kind: 'SPOT', active: true },
  { venue: 'HL', symbol: 'BTC', baseAsset: 'BTC', quoteAsset: 'USDC', kind: 'PERP', active: true, contractMultiplier: 1 }
];

function opportunity(overrides = {}) {
  return {
    now: 1_000,
    spot: instruments[0],
    perp: instruments[1],
    fundingRate: 0.003,
    fundingObservedAt: 900,
    nextFundingAt: 2_000,
    maxFundingAgeMs: 500,
    notional: 10_000,
    entryExitFeeBps: 4,
    expectedSlippageBps: 3,
    basisRiskBps: 2,
    incompleteFillRiskBps: 2,
    capitalCostBps: 1,
    minimumNetCarryBps: 5,
    liquidityScore: 0.9,
    confidence: 0.8,
    killSwitchActive: false,
    ...overrides
  };
}

test('resolves one active spot/perp pair', () => {
  const pair = resolveSpotPerpPair(instruments, 'hl', 'btc', 'usdc');
  assert.equal(pair.spot.symbol, 'UBTC');
  assert.equal(pair.perp.symbol, 'BTC');
  assert.ok(Object.isFrozen(pair));
});

test('rejects ambiguous symbol mapping', () => {
  assert.throws(() => resolveSpotPerpPair([...instruments, { ...instruments[0], symbol: 'BTC-SPOT' }], 'HL', 'BTC', 'USDC'));
});

test('creates positive net carry opportunity after costs', () => {
  const result = scanFundingCarry(opportunity());
  assert.equal(result.netCarryBps, 18);
  assert.equal(result.expectedFundingBps, 30);
  assert.ok(Object.isFrozen(result));
});

test('excludes stale, negative and kill-switched opportunities', () => {
  assert.equal(scanFundingCarry(opportunity({ fundingObservedAt: 0 })), null);
  assert.equal(scanFundingCarry(opportunity({ fundingRate: -0.001 })), null);
  assert.equal(scanFundingCarry(opportunity({ killSwitchActive: true })), null);
});

test('excludes opportunities whose costs consume the edge', () => {
  assert.equal(scanFundingCarry(opportunity({ expectedSlippageBps: 30 })), null);
});

test('reports hedged and rebalance states', () => {
  const hedged = evaluateDeltaNeutralState({
    now: 1_000, spotBaseQuantity: 1, perpShortContracts: 1, contractMultiplier: 1,
    toleranceBaseQuantity: 0.01, emergencyAfterMs: 500, liquidationBuffer: 0.3,
    minimumLiquidationBuffer: 0.2, basisBps: 10, maximumBasisBps: 50
  });
  assert.equal(hedged.status, 'HEDGED');
  const rebalance = evaluateDeltaNeutralState({
    now: 1_000, spotBaseQuantity: 1, perpShortContracts: 0.8, contractMultiplier: 1,
    toleranceBaseQuantity: 0.01, emergencyAfterMs: 500, liquidationBuffer: 0.3,
    minimumLiquidationBuffer: 0.2, basisBps: 10, maximumBasisBps: 50
  });
  assert.equal(rebalance.status, 'REBALANCE_REQUIRED');
});

test('requires emergency exit for prolonged delta or low buffer', () => {
  const state = evaluateDeltaNeutralState({
    now: 1_000, spotBaseQuantity: 1, perpShortContracts: 0.8, contractMultiplier: 1,
    toleranceBaseQuantity: 0.01, breachedSince: 400, emergencyAfterMs: 500,
    liquidationBuffer: 0.1, minimumLiquidationBuffer: 0.2, basisBps: 10, maximumBasisBps: 50
  });
  assert.equal(state.status, 'EMERGENCY_EXIT_REQUIRED');
  assert.ok(state.reasons.includes('LIQUIDATION_BUFFER_LOW'));
});

test('exit engine holds, reduces and exits deterministically', () => {
  const base = {
    fundingRate: 0.001, netCarryBps: 8, basisBps: 10, maximumBasisBps: 50,
    liquidityScore: 0.9, minimumLiquidityScore: 0.5, liquidationBuffer: 0.3,
    minimumLiquidationBuffer: 0.2, killSwitchActive: false, withdrawalReservationActive: false
  };
  assert.equal(decideFundingCarryExit(base).action, 'HOLD');
  assert.equal(decideFundingCarryExit({ ...base, withdrawalReservationActive: true }).action, 'REDUCE');
  assert.equal(decideFundingCarryExit({ ...base, fundingRate: 0 }).action, 'EXIT');
});
