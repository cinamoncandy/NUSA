const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateFundingPersistenceFeature } = require("../dist/apps/cloud/src/alpha/funding/FundingPersistenceFeature.js");

const policy = Object.freeze({
  featureVersion: 1,
  lookbackSamples: 5,
  extremeZScore: 0.7,
  maximumGapMs: 60 * 60 * 1000,
  minimumIndexPrice: 1
});

const makeSamples = () => Object.freeze([
  Object.freeze({ sampleId: "s1", market: "BTCUSDT", closeTime: "2026-07-13T00:00:00.000Z", fundingRate: 0.001, markPrice: 100, indexPrice: 99.8, openInterest: 1000, volume: 500 }),
  Object.freeze({ sampleId: "s2", market: "BTCUSDT", closeTime: "2026-07-13T01:00:00.000Z", fundingRate: 0.0015, markPrice: 101, indexPrice: 100.5, openInterest: 1100, volume: 520 }),
  Object.freeze({ sampleId: "s3", market: "BTCUSDT", closeTime: "2026-07-13T02:00:00.000Z", fundingRate: 0.002, markPrice: 102, indexPrice: 101.4, openInterest: 1200, volume: 540 }),
  Object.freeze({ sampleId: "s4", market: "BTCUSDT", closeTime: "2026-07-13T03:00:00.000Z", fundingRate: 0.004, markPrice: 103, indexPrice: 102.2, openInterest: 1300, volume: 600 }),
  Object.freeze({ sampleId: "s5", market: "BTCUSDT", closeTime: "2026-07-13T04:00:00.000Z", fundingRate: 0.006, markPrice: 104, indexPrice: 103, openInterest: 1430, volume: 660 })
]);

test("calculates deterministic immutable funding persistence features", () => {
  const first = calculateFundingPersistenceFeature(makeSamples(), "2026-07-13T04:00:01.000Z", policy);
  const second = calculateFundingPersistenceFeature(makeSamples(), "2026-07-13T04:00:01.000Z", policy);
  assert.deepEqual(first, second);
  assert.equal(first.featureId, "FUNDING_PERSISTENCE");
  assert.equal(first.market, "BTCUSDT");
  assert.equal(first.direction, "POSITIVE");
  assert.ok(first.fundingZScore > 0);
  assert.ok(first.persistenceSamples >= 1);
  assert.ok(first.openInterestDelta > 0);
  assert.ok(first.volumeDelta > 0);
  assert.ok(first.basisRate > 0);
  assert.equal(first.provenance.length, 5);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.warnings));
  assert.ok(Object.isFrozen(first.provenance));
});

test("uses only the declared trailing lookback window", () => {
  const leading = Object.freeze({ sampleId: "old", market: "BTCUSDT", closeTime: "2026-07-12T23:00:00.000Z", fundingRate: -9, markPrice: 100, indexPrice: 100, openInterest: 1, volume: 1 });
  const result = calculateFundingPersistenceFeature(Object.freeze([leading, ...makeSamples()]), "2026-07-13T04:00:01.000Z", policy);
  assert.deepEqual(result.provenance, ["s1", "s2", "s3", "s4", "s5"]);
});

test("fails closed on future, duplicate, mixed-market, and gapped samples", () => {
  const samples = makeSamples();
  assert.throws(() => calculateFundingPersistenceFeature(samples, "2026-07-13T03:59:59.000Z", policy), /future/);
  assert.throws(() => calculateFundingPersistenceFeature(Object.freeze([samples[0], samples[1], samples[2], samples[3], { ...samples[3] }]), "2026-07-13T05:00:00.000Z", policy), /duplicate sample/);
  assert.throws(() => calculateFundingPersistenceFeature(Object.freeze([samples[0], samples[1], samples[2], samples[3], { ...samples[4], market: "ETHUSDT" }]), "2026-07-13T05:00:00.000Z", policy), /does not match/);
  assert.throws(() => calculateFundingPersistenceFeature(Object.freeze([samples[0], samples[1], samples[2], samples[3], { ...samples[4], closeTime: "2026-07-13T06:00:00.000Z" }]), "2026-07-13T06:00:01.000Z", policy), /gap exceeds/);
});

test("marks zero-variance funding as neutral with reduced quality", () => {
  const samples = Object.freeze(makeSamples().map((sample) => Object.freeze({ ...sample, fundingRate: 0.001 })));
  const result = calculateFundingPersistenceFeature(samples, "2026-07-13T04:00:01.000Z", policy);
  assert.equal(result.direction, "NEUTRAL");
  assert.equal(result.fundingZScore, 0);
  assert.equal(result.persistenceSamples, 0);
  assert.ok(result.warnings.includes("ZERO_FUNDING_VARIANCE"));
  assert.ok(result.quality < 1);
});

test("rejects invalid policies and insufficient samples", () => {
  assert.throws(() => calculateFundingPersistenceFeature(makeSamples().slice(0, 4), "2026-07-13T04:00:01.000Z", policy), /at least 5 samples/);
  assert.throws(() => calculateFundingPersistenceFeature(makeSamples(), "2026-07-13T04:00:01.000Z", { ...policy, lookbackSamples: 2 }), /at least 3/);
  assert.throws(() => calculateFundingPersistenceFeature(makeSamples(), "2026-07-13T04:00:01.000Z", { ...policy, extremeZScore: 0 }), /must be positive/);
});
