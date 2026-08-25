const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateExecutionDigitalTwin,
} = require('../scripts/execution-digital-twin.js');

const thresholds = () => ({
  medianPriceErrorBps: { degradedAbove: 2, unreliableAbove: 5 },
  p95PriceErrorBps: { degradedAbove: 5, unreliableAbove: 10 },
  meanFillRatioErrorPct: { degradedAbove: 5, unreliableAbove: 20 },
  rejectMismatchRatePct: { degradedAbove: 5, unreliableAbove: 15 },
  partialFillMismatchRatePct: { degradedAbove: 10, unreliableAbove: 30 },
  medianLatencyErrorMs: { degradedAbove: 25, unreliableAbove: 100 },
  meanFeeErrorBpsOfNotional: { degradedAbove: 0.5, unreliableAbove: 2 },
});

function leg(overrides = {}) {
  return {
    filledQty: 1,
    avgFillPrice: 100,
    latencyMs: 20,
    fee: 0.01,
    rejected: false,
    ...overrides,
  };
}

function sample(id, overrides = {}) {
  return {
    sampleId: id,
    requestedQty: 1,
    predicted: leg(),
    observed: leg(),
    ...overrides,
  };
}

function input(samples, policyOverrides = {}) {
  return {
    schemaVersion: 1,
    twinId: 'twin-1',
    samples,
    policy: {
      minSamples: 3,
      minPriceSamples: 2,
      thresholds: thresholds(),
      ...policyOverrides,
    },
  };
}

test('perfect paired execution evidence is HEALTHY and has zero authority', () => {
  const result = evaluateExecutionDigitalTwin(input([sample('a'), sample('b'), sample('c')]));
  assert.equal(result.status, 'HEALTHY');
  assert.equal(result.realityGap, 0);
  assert.equal(result.evidenceOnly, true);
  assert.equal(result.mutationAuthorized, false);
  assert.equal(result.liveAuthority, 'NONE');
  assert.equal(result.sampleCount, 3);
  assert.match(result.binding.samplesHash, /^sha256:[0-9a-f]{64}$/);
});

test('insufficient sample evidence fails closed as UNKNOWN', () => {
  const result = evaluateExecutionDigitalTwin(input([sample('a')]));
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.mutationAuthorized, false);
  assert.ok(result.reasons.includes('TWIN_SAMPLE_COUNT_INSUFFICIENT'));
  assert.ok(result.reasons.includes('TWIN_PRICE_SAMPLE_COUNT_INSUFFICIENT'));
});

test('moderate price divergence is DEGRADED but remains evidence-only', () => {
  const samples = [
    sample('a', { observed: leg({ avgFillPrice: 100.03 }) }),
    sample('b', { observed: leg({ avgFillPrice: 100.03 }) }),
    sample('c', { observed: leg({ avgFillPrice: 100.03 }) }),
  ];
  const result = evaluateExecutionDigitalTwin(input(samples));
  assert.equal(result.status, 'DEGRADED');
  assert.ok(result.metrics.medianPriceErrorBps > 2);
  assert.equal(result.liveAuthority, 'NONE');
});

test('large fill and rejection divergence is UNRELIABLE', () => {
  const rejected = leg({ filledQty: 0, avgFillPrice: null, fee: 0, rejected: true });
  const predictedPartial = leg({ filledQty: 0.5, avgFillPrice: 100 });
  const samples = [
    sample('a', { predicted: predictedPartial, observed: rejected }),
    sample('b', { predicted: leg(), observed: rejected }),
    sample('c'),
  ];
  const result = evaluateExecutionDigitalTwin(input(samples, { minPriceSamples: 1 }));
  assert.equal(result.status, 'UNRELIABLE');
  assert.ok(result.metrics.rejectMismatchRatePct > 15);
  assert.ok(result.metrics.meanFillRatioErrorPct > 20);
});

test('sample ordering does not change metrics or evidence binding', () => {
  const a = sample('a', { observed: leg({ avgFillPrice: 100.01, latencyMs: 25 }) });
  const b = sample('b', { observed: leg({ avgFillPrice: 100.02, latencyMs: 30 }) });
  const c = sample('c', { observed: leg({ avgFillPrice: 100.03, latencyMs: 35 }) });
  const first = evaluateExecutionDigitalTwin(input([a, b, c]));
  const second = evaluateExecutionDigitalTwin(input([c, a, b]));
  assert.deepEqual(first.metrics, second.metrics);
  assert.equal(first.binding.samplesHash, second.binding.samplesHash);
});

test('duplicate sample ids are INVALID', () => {
  const result = evaluateExecutionDigitalTwin(input([sample('a'), sample('a'), sample('c')]));
  assert.equal(result.status, 'INVALID');
  assert.ok(result.reasons.includes('TWIN_SAMPLE_ID_DUPLICATE'));
});

test('malformed fill evidence is INVALID', () => {
  const broken = sample('a', { observed: leg({ filledQty: 2 }) });
  const result = evaluateExecutionDigitalTwin(input([broken, sample('b'), sample('c')]));
  assert.equal(result.status, 'INVALID');
  assert.ok(result.reasons.includes('TWIN_SAMPLE_INVALID'));
});

test('zero-fill rejected samples do not fabricate price evidence', () => {
  const rejected = leg({ filledQty: 0, avgFillPrice: null, fee: 0, rejected: true });
  const result = evaluateExecutionDigitalTwin(input([
    sample('a', { predicted: rejected, observed: rejected }),
    sample('b', { predicted: rejected, observed: rejected }),
    sample('c', { predicted: rejected, observed: rejected }),
  ]));
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.priceSampleCount, 0);
  assert.equal(result.metrics.medianPriceErrorBps, null);
  assert.ok(result.reasons.includes('TWIN_PRICE_SAMPLE_COUNT_INSUFFICIENT'));
});
