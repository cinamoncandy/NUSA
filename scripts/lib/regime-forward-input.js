"use strict";
const { verifyHistoricalDatasetManifest } = require("../../dist/apps/desktop/src/cloud/researchDataset.js");
const START = Date.parse("2026-10-14T00:00:00Z");
const END = Date.parse("2026-12-13T00:00:00Z");
const SOURCE_SHA = "f12a7b8216e64933c8a6f1c8c9b5797c3a8abb62";

function prepareForwardInput(input) {
  const insufficient = reason => ({ status: "INSUFFICIENT_DATA", reason, authority: "RESEARCH_ONLY" });
  if (!input || !Number.isSafeInteger(input.evaluatedAt) || input.evaluatedAt < END) return insufficient("HOLDOUT_NOT_COMPLETE");
  const p = input.provenance;
  if (!p || p.sourceIdentity !== "UPBIT_PUBLIC_CANDLES" || p.sourceSha !== SOURCE_SHA || p.datasetVersion !== 1 ||
      !Number.isSafeInteger(p.acquiredAt) || p.acquiredAt < END || p.acquiredAt > input.evaluatedAt ||
      p.lineage !== "UPBIT_PUBLIC_CANDLES_TO_RESEARCH_CANDLE_V1" || p.retentionPolicy !== "RESEARCH_AUDIT_RETAIN") return insufficient("PROVENANCE_INVALID");
  try {
    const manifest = input.manifest;
    if (!manifest || manifest.source !== p.sourceIdentity || manifest.market !== "KRW-BTC" || manifest.interval !== "60m" ||
        manifest.missingCandlePolicy !== "REJECT" || Date.parse(manifest.createdAt) !== p.acquiredAt) return insufficient("MANIFEST_INVALID");
    const { candles } = verifyHistoricalDatasetManifest(manifest, input.candles);
    if (candles.length !== 1440 || candles[0].openTime !== START || candles.at(-1).closeTime !== END) return insufficient("HOLDOUT_COVERAGE_INVALID");
    return { status: "VALIDATED_INPUT", authority: "RESEARCH_ONLY", contentSha256: manifest.contentSha256,
      provenance: { sourceIdentity: p.sourceIdentity, sourceSha: p.sourceSha, datasetVersion: p.datasetVersion,
        acquiredAt: p.acquiredAt, lineage: p.lineage, retentionPolicy: p.retentionPolicy }, evaluatedAt: input.evaluatedAt,
      points: candles.map(c => ({ timestamp: c.closeTime, close: c.close })) };
  } catch { return insufficient("DATASET_INVALID"); }
}
module.exports = { prepareForwardInput };
