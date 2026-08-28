const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");

const BASE = 1_800_000_000_000;
const HASH = "a".repeat(64);
const ADVISORY = { schemaVersion: 1, generatedAt: new Date(BASE - 100).toISOString(), policy: { maximumCandidateWeight: 1, minimumEvidenceBreadth: 0, maximumCandidateCount: 5, maximumFamilyWeight: 1 }, entries: [{ id: "candidate-a", familyId: "family-a", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1, reasons: ["NO_EXECUTION_AUTHORITY"], sourceDatasetIds: ["dataset-a"] }], excludedCandidateIds: [], reasons: ["NO_EXECUTION_AUTHORITY"], provenance: { sourceDatasetIds: ["dataset-a"] } };
const PROVENANCE = [{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }];
const PLAN = { periodId: "runtime-period", periodIndex: 0, advisory: ADVISORY, candidateProvenance: PROVENANCE, periodStartAt: BASE };
const CLOSE = { envelope: { record: { recordId: PLAN.periodId, periodIndex: PLAN.periodIndex, advisory: PLAN.advisory, periodStartAt: PLAN.periodStartAt, periodEndAt: BASE + 900, realizedReturns: { "candidate-a": 0.01 }, benchmarkReturn: 0, turnoverCostRate: 1, costEvidence: { evidenceId: "cost-runtime-period", source: "PAPER_EXECUTION_RECEIPT", observedAt: BASE + 1, feeRate: 0.001, spreadRate: 0, slippageRate: 0 }, status: "COMPLETED" }, candidateProvenance: PROVENANCE } };

function env(path, port) {
  return { NUSA_CLOUD_STATE_DB_PATH: path, NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: ["runtime", "paper", "period", "fixture", "0123456789"].join("-"), NUSA_CLOUD_UPBIT_PUBLIC_DATA: "false" };
}

test("production startCloudRuntime exposes the canonical durable PAPER period producer", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-paper-period-runtime-"));
  const database = join(directory, "state.sqlite");
  let first;
  let second;
  try {
    first = startCloudRuntime(env(database, 42981));
    first.openPaperRealizedPeriod(PLAN);
    first.observePaperRealizedExecution({ observationId: "runtime-observation", observedAt: BASE + 1, status: "WAIT" });
    assert.deepEqual(first.closePaperRealizedPeriod(CLOSE), CLOSE.envelope);
    await first.stop();
    first = undefined;
    second = startCloudRuntime(env(database, 42981));
    assert.equal(second.listPaperRealizedPeriods().length, 1);
  } finally {
    if (first) await first.stop();
    if (second) await second.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the production PAPER tick path records a runtime observation for an explicitly opened period", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-paper-period-runtime-observation-"));
  const database = join(directory, "state.sqlite");
  let handle;
  try {
    let onTicker;
    const marketFactory = (_markets, tickerCallback) => { onTicker = tickerCallback; return { subscribe() {}, start() {}, stop() {} }; };
    const runtimeEnv = { ...env(database, 42982), NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true", NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC", NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "10000000", NUSA_CLOUD_PAPER_INVESTMENT_PERCENT: "10" };
    handle = startCloudRuntime(runtimeEnv, undefined, undefined, marketFactory);
    const periodStartAt = Date.now() - 1_000;
    const observedAdvisory = { ...ADVISORY, generatedAt: new Date(periodStartAt - 100).toISOString() };
    handle.openPaperRealizedPeriod({ periodId: "runtime-observed-period", periodIndex: 0, advisory: observedAdvisory, candidateProvenance: PROVENANCE, periodStartAt });
    onTicker({ type: "ticker", code: "KRW-BTC", trade_price: 50_000, trade_timestamp: periodStartAt, signed_change_rate: 0.03, acc_trade_price_24h: 1_000_000_000 });
    assert.equal(handle.listPaperRealizedPeriods().length, 0);
    const open = handle.listPaperRealizedPeriods();
    assert.deepEqual(handle.closePaperRealizedPeriod({ envelope: { record: { recordId: "runtime-observed-period", periodIndex: 0, advisory: observedAdvisory, periodStartAt, periodEndAt: Date.now(), realizedReturns: { "candidate-a": 0 }, benchmarkReturn: 0, turnoverCostRate: 0, costEvidence: { evidenceId: "cost-runtime-observed", source: "PAPER_EXECUTION_RECEIPT", observedAt: periodStartAt + 1, feeRate: 0.0005, spreadRate: 0, slippageRate: 0 }, status: "COMPLETED" }, candidateProvenance: PROVENANCE } }).record.recordId, "runtime-observed-period");
    assert.equal(open.length, 0);
  } finally {
    if (handle) await handle.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
