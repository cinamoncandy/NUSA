const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CHART_NORMALIZATION_V1,
  CHART_NORMALIZATION_V1_FINGERPRINT,
  fingerprintChartSignalNormalizationPolicy,
  normalizeChartChangeRate
} = require("../dist/apps/cloud/src/chartSignalNormalization.js");

test("CHART_NORMALIZATION_V1 is deterministic, bounded, and fingerprinted", () => {
  assert.deepEqual(CHART_NORMALIZATION_V1, {
    id: "CHART_NORMALIZATION_V1",
    version: 1,
    referenceMove: 0.03,
    deadZone: 0.002,
    maximumScore: 1
  });
  assert.equal(CHART_NORMALIZATION_V1_FINGERPRINT, "13ff413b000defa68fd77a25b3e5b079caeecc783dda7f16cc7dd0e18f71295f");
  assert.equal(fingerprintChartSignalNormalizationPolicy(CHART_NORMALIZATION_V1), CHART_NORMALIZATION_V1_FINGERPRINT);

  const cases = [[0, 0], [0.002, 0], [0.005, 0.1667], [0.01, 0.3333], [0.02, 0.6667], [0.03, 1], [0.05, 1], [-0.01, -0.3333], [-0.05, -1]];
  for (const [raw, expected] of cases) assert.equal(normalizeChartChangeRate(raw), expected);
});

test("custom policies are validated and independently fingerprinted for challenger experiments", () => {
  const challenger = Object.freeze({ id: "CHART_VOLATILITY_CHALLENGER", version: 1, referenceMove: 0.02, deadZone: 0.001, maximumScore: 1 });
  assert.equal(normalizeChartChangeRate(0.01, challenger), 0.5);
  assert.notEqual(fingerprintChartSignalNormalizationPolicy(challenger), CHART_NORMALIZATION_V1_FINGERPRINT);
  assert.throws(() => normalizeChartChangeRate(0.01, { ...challenger, deadZone: 0.03 }), /dead zone/);
});
