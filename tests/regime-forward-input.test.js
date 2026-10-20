const test = require("node:test");
const assert = require("node:assert/strict");
const { createHistoricalDatasetManifest } = require("../dist/apps/desktop/src/cloud/researchDataset.js");
const { prepareForwardInput } = require("../scripts/lib/regime-forward-input");
const provenanceV2 = require("./helpers/research-dataset-provenance.js");
const start = Date.parse("2026-10-14T00:00:00Z");
const end = Date.parse("2026-12-13T00:00:00Z");
function fixture() {
  const candles = Array.from({ length: 1440 }, (_, i) => ({ market: "KRW-BTC", interval: "60m", openTime: start + i * 3600000,
    closeTime: start + (i + 1) * 3600000, open: 100, high: 101, low: 99, close: 100, volume: 1 }));
  return { candles, evaluatedAt: end, manifest: createHistoricalDatasetManifest(candles, { source: "UPBIT_PUBLIC_CANDLES", createdAt: new Date(end).toISOString(), provenance: provenanceV2 }),
    provenance: { sourceIdentity: "UPBIT_PUBLIC_CANDLES", sourceSha: "f12a7b8216e64933c8a6f1c8c9b5797c3a8abb62", datasetVersion: 1,
      acquiredAt: end, lineage: "UPBIT_PUBLIC_CANDLES_TO_RESEARCH_CANDLE_V1", retentionPolicy: "RESEARCH_AUDIT_RETAIN" } };
}
test("complete synthetic holdout validates input only, never promotes", () => {
  const input = fixture(); input.provenance.untrustedExtra = "PRIVATE_SYNTHETIC_VALUE";
  const result = prepareForwardInput(input);
  assert.equal(result.status, "VALIDATED_INPUT"); assert.equal(result.points.length, 1440); assert.equal(result.authority, "RESEARCH_ONLY");
  assert.equal(result.provenance.untrustedExtra, undefined);
});
test("partial, corrupt, duplicate, inverted and mixed inputs fail closed", () => {
  for (const mutate of [x => x.candles.pop(), x => x.candles[1] = x.candles[0], x => x.candles.reverse(),
    x => x.candles[0].close = 999, x => x.candles[0].market = "KRW-XRP", x => x.manifest = { ...x.manifest, contentSha256: "0".repeat(64) }]) {
    const input = fixture(); mutate(input); assert.equal(prepareForwardInput(input).status, "INSUFFICIENT_DATA");
  }
});
test("future, premature, missing and stale provenance cannot become valid evidence", () => {
  for (const mutate of [x => x.evaluatedAt = end - 1, x => x.provenance.acquiredAt = end + 1,
    x => x.provenance.sourceSha = "0".repeat(40), x => delete x.provenance.lineage, x => x.provenance.sourceIdentity = "PRIVATE_SOURCE"]) {
    const input = fixture(); mutate(input); assert.equal(prepareForwardInput(input).status, "INSUFFICIENT_DATA");
  }
  assert.equal(prepareForwardInput(null).status, "INSUFFICIENT_DATA");
});
