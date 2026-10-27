"use strict";
const { prepareForwardInput } = require("./regime-forward-input");
const { evaluateRegimeCandidate } = require("./regime-forward-candidate");
const { createHistoricalDatasetManifest } = require("../../dist/apps/desktop/src/cloud/researchDataset.js");
const START = Date.parse("2026-10-14T00:00:00Z");
const END = Date.parse("2026-12-13T00:00:00Z");
const SOURCE = "f12a7b8216e64933c8a6f1c8c9b5797c3a8abb62";
const BASE = { market: "KRW-BTC", initialCash: 10000000, orderQuantity: 0.001, feeRate: 0.0005, executionCosts: { spreadBps: 5, slippageBps: 5 } };
const { createHash } = require("node:crypto");
const sha256 = value => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const SPEC_FINGERPRINT = createHash("sha256").update(JSON.stringify({ START, END, specificationSourceSha: SOURCE, BASE, screen: "4-of-6,2x-positive,drawdown-comparator,30-trades-v1" })).digest("hex");

async function runForwardStudy({ now = Date.now, fetchCandles, evaluate = evaluateRegimeCandidate, executionSourceSha = process.env.NUSA_SOURCE_COMMIT_SHA } = {}) {
  if (!/^[a-f0-9]{40}$/.test(executionSourceSha || "")) throw new Error("FORWARD_EXECUTION_SOURCE_UNVERIFIED");
  const evaluatedAt = now();
  if (!Number.isSafeInteger(evaluatedAt) || evaluatedAt < END) return { status: "WAITING_HOLDOUT", authority: "RESEARCH_ONLY", eligibleAt: END, executionSourceSha, specificationSourceSha: SOURCE, specificationFingerprint: SPEC_FINGERPRINT };
  if (typeof fetchCandles !== "function") throw new Error("FORWARD_FETCH_UNAVAILABLE");
  const fetched = await fetchCandles({ market: "KRW-BTC", dataAsOf: END, count: 1440 });
  const acquiredAt = now();
  if (!Array.isArray(fetched.rawSourceIdentitySha256s) || fetched.rawSourceIdentitySha256s.length === 0) throw new Error("FORWARD_SOURCE_PROVENANCE_UNAVAILABLE");
  const provenanceV2 = {
    rawSourceIdentitySha256s: fetched.rawSourceIdentitySha256s,
    transformationGraphSha256: sha256(["UPBIT_PUBLIC_CANDLES", "mapUpbitDayCandlesToResearchCandles", "complete 60m bars", "v2"]),
    transformationConfigSha256: sha256({ market: "KRW-BTC", interval: "60m", dataAsOf: END, count: 1440, ordering: "OPEN_TIME_ASC" }),
    schemaContractSha256: sha256(["CanonicalResearchCandle", "market", "interval", "openTime", "closeTime", "OHLCV"]),
    qualitySuiteSha256: sha256(["completed intervals", "contiguous history", "fixed holdout window", "v1"]),
    qualityResultsSha256: sha256({ candleCount: fetched.candles.length, contiguous: true, completedBy: END }),
    derivedFeatureLineageSha256: sha256({ derivedFeatures: [] }),
    replayRuntimeSha256: sha256({ sourceCommitSha: executionSourceSha, nodeVersion: process.version, specificationFingerprint: SPEC_FINGERPRINT }),
  };
  const input = { candles: fetched.candles, evaluatedAt: acquiredAt,
    manifest: createHistoricalDatasetManifest(fetched.candles, { source: "UPBIT_PUBLIC_CANDLES", createdAt: new Date(acquiredAt).toISOString(), sourceRequest: JSON.stringify(fetched.sourceRequests), provenance: provenanceV2 }),
    provenance: { sourceIdentity: "UPBIT_PUBLIC_CANDLES", sourceSha: SOURCE, datasetVersion: 1, acquiredAt,
      lineage: "UPBIT_PUBLIC_CANDLES_TO_RESEARCH_CANDLE_V1", retentionPolicy: "RESEARCH_AUDIT_RETAIN" } };
  const prepared = prepareForwardInput(input);
  if (prepared.status !== "VALIDATED_INPUT") return prepared;
  const stress = { ...BASE, feeRate: BASE.feeRate * 2, executionCosts: { spreadBps: 10, slippageBps: 10 } };
  const aggregate = evaluate(prepared.points, BASE);
  const stressed = evaluate(prepared.points, stress);
  const blocks = Array.from({ length: 6 }, (_, index) => {
    const points = prepared.points.slice(index * 240, (index + 1) * 240);
    const warmupPoints = prepared.points.slice(Math.max(0, index * 240 - 100), index * 240);
    const result = evaluate(points, { ...BASE, warmupPoints });
    return { index, startAt: START + index * 10 * 86400000, endAt: START + (index + 1) * 10 * 86400000,
      netReturn: result.candidate.metrics.totalReturn };
  });
  const metrics = aggregate.candidate.metrics;
  const sufficient = aggregate.candidate.trades.length >= 30;
  const pass = blocks.filter(b => b.netReturn > 0).length >= 4 && stressed.candidate.metrics.totalReturn > 0 && metrics.maxDrawdown <= aggregate.comparator.metrics.maxDrawdown;
  return { status: !sufficient ? "INSUFFICIENT_DATA" : pass ? "RESEARCH_SCREEN_PASS" : "RESEARCH_SCREEN_FAIL",
    authority: "RESEARCH_ONLY", qualification: "NOT_QUALIFIED", contentSha256: prepared.contentSha256,
    acquiredAt, executionSourceSha, specificationSourceSha: SOURCE, specificationFingerprint: SPEC_FINGERPRINT,
    provenance: prepared.provenance, sourceRequests: fetched.sourceRequests,
    blocks, completedTrades: aggregate.candidate.trades.length,
    netReturn: metrics.totalReturn, stressedNetReturn: stressed.candidate.metrics.totalReturn,
    maxDrawdown: metrics.maxDrawdown, comparatorDrawdown: aggregate.comparator.metrics.maxDrawdown,
    comparatorReturn: aggregate.comparator.metrics.totalReturn, buyAndHoldReturn: metrics.benchmarkReturn,
    cashReturn: 0, datasetEvidence: input };
}
module.exports = { runForwardStudy, SPEC_FINGERPRINT };
