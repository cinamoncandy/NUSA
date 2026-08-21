const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  deriveStrategyFingerprint,
  deriveConfigFingerprint,
  deriveRuntimeFingerprint,
  deriveRiskPolicyFingerprint,
  RISK_POLICY_FINGERPRINT_KEYS,
  FingerprintInputError
} = require("../dist/apps/desktop/src/runtimeFingerprint.js");

const strategy = () => ({ kind: "SMA_CROSSOVER", shortPeriod: 5, longPeriod: 20, timeframeMs: 60000, symbol: "KRW-BTC" });
const config = () => ({ feeRate: 0.0005, slippageBps: 5, spreadBps: 2, maxFillRatio: 1, marketImpactBpsPerUnit: 0, orderQuantity: 0.001, autoTradeDefaultEnabled: false });
const runtime = () => ({ appVersion: "0.1.0", sourceCommitSha: "abc123", persistenceSchemaVersion: 1, platform: "win32", nodeMajorVersion: 24 });
const riskPolicy = () => ({
  maxOrderNotional: 100000, maxPositionNotional: 500000, maxOpenOrders: 5, maxOrdersPerSecond: 3,
  maxOrdersPerMinute: 30, maxSameSideStreak: 5, maxSymbolExposureNotional: 500000,
  maxPortfolioExposureNotional: 1000000, maxDailyBuyNotional: 1000000, maxDailySellNotional: 1000000,
  maxDailyLoss: 50000, maxConsecutiveLosses: 5, maxSessionDrawdownRatio: 0.2, maxPriceDeviationRatio: 0.05
});

const ALL = [
  ["strategy", deriveStrategyFingerprint, strategy],
  ["config", deriveConfigFingerprint, config],
  ["runtime", deriveRuntimeFingerprint, runtime],
  ["riskPolicy", deriveRiskPolicyFingerprint, riskPolicy]
];

test("each fingerprint is deterministic and carries its own domain prefix", () => {
  for (const [domain, derive, build] of ALL) {
    assert.equal(derive(build()), derive(build()), `${domain} is not deterministic`);
    assert.ok(derive(build()).startsWith(`${domain}-`), `${domain} fingerprint must be self-describing`);
  }
});

test("the four fingerprints are distinct even for structurally similar input", () => {
  const values = ALL.map(([, derive, build]) => derive(build()));
  assert.equal(new Set(values).size, values.length);
});

test("key order does not affect any fingerprint", () => {
  for (const [domain, derive, build] of ALL) {
    const original = build();
    const reordered = Object.fromEntries(Object.entries(original).reverse());
    assert.equal(derive(reordered), derive(original), `${domain} is order-sensitive`);
  }
});

test("changing any single covered field changes the fingerprint", () => {
  // This is the property the risk gateway's mismatch check depends on. A field that can
  // change without moving the digest is a change the gateway cannot see.
  const perturb = (value) => {
    if (typeof value === "number") return value + 1;
    if (typeof value === "boolean") return !value;
    return `${value}-changed`;
  };
  for (const [domain, derive, build] of ALL) {
    const base = build();
    const baseline = derive(base);
    for (const key of Object.keys(base)) {
      const mutated = { ...base, [key]: perturb(base[key]) };
      let changed;
      try {
        changed = derive(mutated) !== baseline;
      } catch (error) {
        // A perturbation the validator rejects (e.g. maxFillRatio > 1) still proves the
        // field is not silently ignored.
        assert.ok(error instanceof FingerprintInputError, `${domain}.${key}: unexpected error ${error}`);
        continue;
      }
      assert.ok(changed, `${domain}.${key} does not affect the fingerprint`);
    }
  }
});

test("an unknown field is a loud error, not a silently ignored one", () => {
  for (const [domain, derive, build] of ALL) {
    assert.throws(() => derive({ ...build(), somethingNew: 1 }), FingerprintInputError, `${domain} silently accepted an unknown field`);
  }
});

test("a missing field is rejected rather than fingerprinted as a different identity", () => {
  for (const [domain, derive, build] of ALL) {
    const base = build();
    const key = Object.keys(base)[0];
    const partial = { ...base };
    delete partial[key];
    assert.throws(() => derive(partial), FingerprintInputError, `${domain} accepted input missing ${key}`);
  }
});

test("invalid values are rejected", () => {
  assert.throws(() => deriveStrategyFingerprint({ ...strategy(), shortPeriod: 20, longPeriod: 5 }), FingerprintInputError);
  assert.throws(() => deriveStrategyFingerprint({ ...strategy(), timeframeMs: 0 }), FingerprintInputError);
  assert.throws(() => deriveConfigFingerprint({ ...config(), maxFillRatio: 0 }), FingerprintInputError);
  assert.throws(() => deriveConfigFingerprint({ ...config(), feeRate: -1 }), FingerprintInputError);
  assert.throws(() => deriveRuntimeFingerprint({ ...runtime(), appVersion: "" }), FingerprintInputError);
  assert.throws(() => deriveRiskPolicyFingerprint({ ...riskPolicy(), maxDailyLoss: Number.NaN }), FingerprintInputError);
  for (const [, derive] of ALL) assert.throws(() => derive(null), FingerprintInputError);
});

test("the risk-policy fingerprint covers exactly the gateway's limit fields", () => {
  // If a limit is added to IndependentRiskLimits and not here, relaxing that limit would
  // leave the fingerprint unchanged -- exactly the change the fingerprint exists to catch.
  // apps/desktop/src/risk/independentRiskGateway.ts is a re-export shim; the real source lives
  // in packages/core, shared with apps/cloud/src.
  const source = fs.readFileSync(path.join(__dirname, "..", "packages", "core", "src", "independentRiskGateway.ts"), "utf8");
  const start = source.indexOf("export interface IndependentRiskLimits");
  const block = source.slice(start, source.indexOf("}", start));
  const declared = [...block.matchAll(/readonly\s+(\w+)\s*:/g)].map((match) => match[1]);
  assert.deepEqual([...RISK_POLICY_FINGERPRINT_KEYS].sort(), [...declared].sort());
});
