const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../scripts/lib/preregisteredStudyStats.js");

test("cohort minimums use integer arithmetic: 27 of 30 and 162 of 180", () => {
  assert.equal(S.minimumCount(30), 27);
  assert.equal(S.minimumCount(180), 162);
  assert.equal(S.minimumCount(17), 16);
  assert.equal(S.minimumCount(102), 92);
});

test("net return is multiplicative and pays the spread through ask and bid", () => {
  const r = S.tradeNet({ askEntry: 100, bidExit: 100, entryBp: 10, exitBp: 10 });
  assert.ok(Math.abs(r - ((100 * 0.999) / (100 * 1.001) - 1)) < 1e-15);
  assert.ok(S.tradeNet({ askEntry: 100.1, bidExit: 99.9, entryBp: 0, exitBp: 0 }) < 0, "a flat mid loses the spread");
});

test("percentile ranks are ascending, average ties, and single values read 0.5", () => {
  assert.deepEqual(S.percentileRanks([10, 30, 20]), [0, 1, 0.5]);
  assert.deepEqual(S.percentileRanks([5, 5, 9]), [0.25, 0.25, 1]);
  assert.deepEqual(S.percentileRanks([7]), [0.5]);
  assert.deepEqual(S.percentileRanks([]), []);
});

test("market codes compare bytewise and the median is the upper one", () => {
  assert.equal(S.compareCodes("KRW-BTC", "KRW-ETH"), -1);
  assert.equal(S.compareCodes("KRW-btc", "KRW-ABC"), 1, "lower-case sorts after upper-case bytewise");
  assert.equal(S.upperMedian([1, 2, 3, 4]), 3);
  assert.equal(S.upperMedian([]), Infinity);
});

test("the Student t tail matches known values", () => {
  assert.ok(Math.abs(S.studentTUpperP(0, 10) - 0.5) < 1e-12);
  assert.ok(Math.abs(S.studentTUpperP(1, 1) - 0.25) < 1e-9, "Cauchy: 0.5 - atan(1)/pi");
  assert.ok(Math.abs(S.studentTUpperP(2.045, 29) - 0.025) < 5e-4, "t(0.975, 29) = 2.045");
  assert.ok(Math.abs(S.studentTUpperP(-2.045, 29) - 0.975) < 5e-4);
  assert.ok(Math.abs(S.studentTUpperP(12.706, 1) - 0.025) < 5e-4, "t(0.975, 1) = 12.706");
  assert.equal(S.studentTUpperP(Infinity, 5), 1, "a non-finite statistic never passes");
});

test("the permutation test is deterministic for its seed and separates a clear shift from noise", () => {
  const shifted = Array.from({ length: 30 }, (_, i) => 0.02 + 0.001 * Math.sin(i));
  const noise = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
  const a = S.signFlipP(shifted, { flips: 5000 }), b = S.signFlipP(shifted, { flips: 5000 });
  assert.equal(a, b);
  assert.ok(a < 0.01);
  assert.ok(S.signFlipP(noise, { flips: 5000 }) > 0.4);
  assert.equal(S.signFlipP([], {}), 1);
});

test("both tests must pass; a zero sd or too few cohorts fails", () => {
  const strong = Array.from({ length: 30 }, (_, i) => 0.05 + 0.005 * Math.sin(i * 1.7));
  assert.equal(S.oneSidedTests(strong, 0.05 / 3, { flips: 20_000 }).pass, true);
  assert.equal(S.oneSidedTests(new Array(30).fill(0.01), 0.05 / 3, { flips: 100 }).pass, false, "sd 0 fails");
  assert.equal(S.oneSidedTests([0.1], 0.05 / 3, { flips: 100 }).pass, false);
  const weak = Array.from({ length: 30 }, (_, i) => 0.002 + (i % 2 ? 0.03 : -0.03));
  assert.equal(S.oneSidedTests(weak, 0.05 / 3, { flips: 20_000 }).pass, false);
});

test("the critical t inverts the tail and matches the design's ~2.2 at 29 df and alpha 0.0167", () => {
  const c = S.studentTCritical(0.05 / 3, 29);
  assert.ok(c > 2.1 && c < 2.3, String(c));
  assert.ok(Math.abs(S.studentTUpperP(c, 29) - 0.05 / 3) < 1e-9);
});
