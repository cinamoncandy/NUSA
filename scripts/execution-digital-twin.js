"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const STATUS = Object.freeze({
  HEALTHY: "HEALTHY",
  DEGRADED: "DEGRADED",
  UNRELIABLE: "UNRELIABLE",
  UNKNOWN: "UNKNOWN",
  INVALID: "INVALID",
});

const METRIC_IDS = Object.freeze([
  "medianPriceErrorBps",
  "p95PriceErrorBps",
  "meanFillRatioErrorPct",
  "rejectMismatchRatePct",
  "partialFillMismatchRatePct",
  "medianLatencyErrorMs",
  "meanFeeErrorBpsOfNotional",
]);

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function sha256Json(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

function percentile(values, quantile) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index];
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits = 6) {
  if (value === null || value === undefined || !Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isPartial(fillQty, requestedQty) {
  return fillQty > 0 && fillQty < requestedQty;
}

function validateExecutionLeg(leg, requestedQty) {
  if (!leg || typeof leg !== "object") return false;
  if (typeof leg.rejected !== "boolean") return false;
  if (!finiteNonNegative(leg.filledQty) || leg.filledQty > requestedQty) return false;
  if (!finiteNonNegative(leg.latencyMs) || !finiteNonNegative(leg.fee)) return false;
  if (leg.filledQty > 0 && !finitePositive(leg.avgFillPrice)) return false;
  if (leg.filledQty === 0 && !(leg.avgFillPrice === null || leg.avgFillPrice === undefined)) return false;
  if (leg.rejected && leg.filledQty !== 0) return false;
  return true;
}

function validateSample(sample) {
  if (!sample || typeof sample !== "object" || !nonEmpty(sample.sampleId)) return false;
  if (!finitePositive(sample.requestedQty)) return false;
  if (!validateExecutionLeg(sample.predicted, sample.requestedQty)) return false;
  if (!validateExecutionLeg(sample.observed, sample.requestedQty)) return false;
  return true;
}

function validateMetricThreshold(value) {
  return value && typeof value === "object" &&
    finiteNonNegative(value.degradedAbove) &&
    finiteNonNegative(value.unreliableAbove) &&
    value.degradedAbove <= value.unreliableAbove;
}

function validatePolicy(policy) {
  if (!policy || typeof policy !== "object") return false;
  if (!positiveSafeInteger(policy.minSamples) || !positiveSafeInteger(policy.minPriceSamples)) return false;
  if (policy.minPriceSamples > policy.minSamples) return false;
  if (!policy.thresholds || typeof policy.thresholds !== "object") return false;
  return METRIC_IDS.every((id) => validateMetricThreshold(policy.thresholds[id]));
}

function invalidResult(reasons) {
  return Object.freeze({
    schemaVersion: 1,
    status: STATUS.INVALID,
    realityGap: null,
    sampleCount: 0,
    priceSampleCount: 0,
    evidenceOnly: true,
    mutationAuthorized: false,
    liveAuthority: "NONE",
    binding: null,
    metrics: null,
    reasons: Object.freeze([...new Set(reasons)].sort()),
    checks: Object.freeze([]),
  });
}

function metricStatus(value, threshold) {
  if (value === null || value === undefined || !Number.isFinite(value)) return STATUS.UNKNOWN;
  if (value > threshold.unreliableAbove) return STATUS.UNRELIABLE;
  if (value > threshold.degradedAbove) return STATUS.DEGRADED;
  return STATUS.HEALTHY;
}

function aggregateStatus(checks) {
  if (checks.some((check) => check.status === STATUS.UNRELIABLE)) return STATUS.UNRELIABLE;
  if (checks.some((check) => check.status === STATUS.UNKNOWN)) return STATUS.UNKNOWN;
  if (checks.some((check) => check.status === STATUS.DEGRADED)) return STATUS.DEGRADED;
  return STATUS.HEALTHY;
}

function realityGap(metrics, thresholds) {
  const normalized = METRIC_IDS
    .map((id) => {
      const value = metrics[id];
      const hard = thresholds[id].unreliableAbove;
      if (!Number.isFinite(value)) return null;
      if (hard === 0) return value === 0 ? 0 : 1;
      return Math.min(1, value / hard);
    })
    .filter((value) => value !== null);
  return round((mean(normalized) ?? 1) * 100, 3);
}

function evaluateExecutionDigitalTwin(input) {
  if (!input || typeof input !== "object" || input.schemaVersion !== 1 || !nonEmpty(input.twinId)) {
    return invalidResult(["TWIN_REQUEST_INVALID"]);
  }
  if (!validatePolicy(input.policy)) return invalidResult(["TWIN_POLICY_INVALID"]);
  if (!Array.isArray(input.samples)) return invalidResult(["TWIN_SAMPLES_INVALID"]);
  if (!input.samples.every(validateSample)) return invalidResult(["TWIN_SAMPLE_INVALID"]);

  const sampleIds = input.samples.map((sample) => sample.sampleId);
  if (new Set(sampleIds).size !== sampleIds.length) return invalidResult(["TWIN_SAMPLE_ID_DUPLICATE"]);

  const samples = [...input.samples].sort((a, b) => a.sampleId.localeCompare(b.sampleId));
  const priceErrors = [];
  const latencyErrors = [];
  const fillRatioErrors = [];
  const feeErrors = [];
  let rejectMismatches = 0;
  let partialFillMismatches = 0;

  for (const sample of samples) {
    const { requestedQty, predicted, observed } = sample;
    const predictedRatio = predicted.filledQty / requestedQty;
    const observedRatio = observed.filledQty / requestedQty;
    fillRatioErrors.push(Math.abs(observedRatio - predictedRatio) * 100);
    latencyErrors.push(Math.abs(observed.latencyMs - predicted.latencyMs));

    if (predicted.rejected !== observed.rejected) rejectMismatches += 1;
    if (isPartial(predicted.filledQty, requestedQty) !== isPartial(observed.filledQty, requestedQty)) partialFillMismatches += 1;

    if (predicted.filledQty > 0 && observed.filledQty > 0) {
      const referencePrice = predicted.avgFillPrice;
      priceErrors.push(Math.abs(observed.avgFillPrice - referencePrice) / referencePrice * 10000);

      const predictedNotional = predicted.avgFillPrice * predicted.filledQty;
      const observedNotional = observed.avgFillPrice * observed.filledQty;
      const referenceNotional = Math.max(predictedNotional, observedNotional);
      if (referenceNotional > 0) {
        feeErrors.push(Math.abs(observed.fee - predicted.fee) / referenceNotional * 10000);
      }
    }
  }

  const metrics = Object.freeze({
    medianPriceErrorBps: round(percentile(priceErrors, 0.5)),
    p95PriceErrorBps: round(percentile(priceErrors, 0.95)),
    meanFillRatioErrorPct: round(mean(fillRatioErrors)),
    rejectMismatchRatePct: round(samples.length ? rejectMismatches / samples.length * 100 : null),
    partialFillMismatchRatePct: round(samples.length ? partialFillMismatches / samples.length * 100 : null),
    medianLatencyErrorMs: round(percentile(latencyErrors, 0.5)),
    meanFeeErrorBpsOfNotional: round(mean(feeErrors)),
  });

  const checks = [];
  if (samples.length < input.policy.minSamples) {
    checks.push(Object.freeze({
      id: "sample-count",
      status: STATUS.UNKNOWN,
      reason: "TWIN_SAMPLE_COUNT_INSUFFICIENT",
      actual: samples.length,
      required: input.policy.minSamples,
    }));
  } else {
    checks.push(Object.freeze({ id: "sample-count", status: STATUS.HEALTHY, reason: "TWIN_SAMPLE_COUNT_SUFFICIENT" }));
  }

  if (priceErrors.length < input.policy.minPriceSamples) {
    checks.push(Object.freeze({
      id: "price-sample-count",
      status: STATUS.UNKNOWN,
      reason: "TWIN_PRICE_SAMPLE_COUNT_INSUFFICIENT",
      actual: priceErrors.length,
      required: input.policy.minPriceSamples,
    }));
  } else {
    checks.push(Object.freeze({ id: "price-sample-count", status: STATUS.HEALTHY, reason: "TWIN_PRICE_SAMPLE_COUNT_SUFFICIENT" }));
  }

  for (const id of METRIC_IDS) {
    const status = metricStatus(metrics[id], input.policy.thresholds[id]);
    checks.push(Object.freeze({
      id,
      status,
      reason: status === STATUS.HEALTHY
        ? "TWIN_METRIC_WITHIN_POLICY"
        : status === STATUS.DEGRADED
          ? "TWIN_METRIC_DEGRADED"
          : status === STATUS.UNRELIABLE
            ? "TWIN_METRIC_UNRELIABLE"
            : "TWIN_METRIC_UNKNOWN",
      value: metrics[id],
      threshold: Object.freeze({ ...input.policy.thresholds[id] }),
    }));
  }

  const status = aggregateStatus(checks);
  const reasons = [...new Set(checks.filter((check) => check.status !== STATUS.HEALTHY).map((check) => check.reason))].sort();

  return Object.freeze({
    schemaVersion: 1,
    twinId: input.twinId,
    status,
    realityGap: realityGap(metrics, input.policy.thresholds),
    sampleCount: samples.length,
    priceSampleCount: priceErrors.length,
    evidenceOnly: true,
    mutationAuthorized: false,
    liveAuthority: "NONE",
    binding: Object.freeze({
      samplesHash: sha256Json(samples),
      policyHash: sha256Json(input.policy),
    }),
    metrics,
    reasons: Object.freeze(reasons),
    checks: Object.freeze(checks),
  });
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node scripts/execution-digital-twin.js <twin-input.json>");
    process.exitCode = 64;
    return;
  }

  const absolutePath = path.resolve(process.cwd(), inputPath);
  const input = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const evaluation = evaluateExecutionDigitalTwin(input);
  console.log(JSON.stringify(evaluation, null, 2));
  process.exitCode = evaluation.status === STATUS.HEALTHY
    ? 0
    : evaluation.status === STATUS.DEGRADED
      ? 2
      : evaluation.status === STATUS.UNRELIABLE
        ? 3
        : evaluation.status === STATUS.UNKNOWN
          ? 4
          : 64;
}

if (require.main === module) main();

module.exports = {
  STATUS,
  METRIC_IDS,
  evaluateExecutionDigitalTwin,
  percentile,
  sha256Json,
};
