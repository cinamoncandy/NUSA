const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqlitePaperRealizedPeriodRepository } = require("../dist/apps/cloud/src/paperRealizedPeriodProducer.js");
const { PAPER_FORWARD_EVIDENCE_DEFAULT_POLICY } = require("../dist/apps/desktop/src/cloud/paperForwardEvidenceAdmission.js");

const BASE = 1_800_000_000_000;
const HASH = "a".repeat(64);
const ADVISORY = { schemaVersion: 1, generatedAt: new Date(BASE - 100).toISOString(), policy: { maximumCandidateWeight: 1, minimumEvidenceBreadth: 0, maximumCandidateCount: 5, maximumFamilyWeight: 1 }, entries: [{ id: "candidate-a", familyId: "family-a", rank: 1, leagueScore: 1, evidenceBreadth: 1, researchWeight: 1, reasons: ["NO_EXECUTION_AUTHORITY"], sourceDatasetIds: ["dataset-a"] }], excludedCandidateIds: [], reasons: ["NO_EXECUTION_AUTHORITY"], provenance: { sourceDatasetIds: ["dataset-a"] } };
const PROVENANCE = [{ candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH }];
const PLAN = { periodId: "runtime-period", periodIndex: 0, advisory: ADVISORY, candidateProvenance: PROVENANCE, periodStartAt: BASE };
const CLOSE = { envelope: { record: { recordId: PLAN.periodId, periodIndex: PLAN.periodIndex, advisory: PLAN.advisory, periodStartAt: PLAN.periodStartAt, periodEndAt: BASE + 900, realizedReturns: { "candidate-a": 0.01 }, benchmarkReturn: 0, turnoverCostRate: 1, costEvidence: { evidenceId: "cost-runtime-period", source: "PAPER_EXECUTION_RECEIPT", evidenceKind: "CONSERVATIVE_MODEL", evidenceFingerprintSha256: "a".repeat(64), observedAt: BASE + 1, feeRate: 0.001, spreadRate: 0, slippageRate: 0 }, status: "COMPLETED" }, candidateProvenance: PROVENANCE } };

function env(path, port) {
  return { NUSA_CLOUD_STATE_DB_PATH: path, NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: ["runtime", "paper", "period", "fixture", "0123456789"].join("-"), NUSA_CLOUD_UPBIT_PUBLIC_DATA: "false" };
}

function seedHourlyPeriods(database, count) {
  const db = new SqliteDatabase(database);
  try {
    const repository = new SqlitePaperRealizedPeriodRepository(db);
    db.transaction(() => {
      for (let index = 0; index < count; index += 1) {
        const start = BASE + index * 3_600_000;
        repository.append({ ...CLOSE.envelope, record: { ...CLOSE.envelope.record,
          recordId: `hourly-${index}`, periodIndex: index, periodStartAt: start, periodEndAt: start + 3_600_000,
          costEvidence: { ...CLOSE.envelope.record.costEvidence, evidenceId: `cost-hourly-${index}`, observedAt: start + 1 },
        } });
      }
    });
  } finally { db.close(); }
}

test("Cloud runtime retains thirty covered days of hourly evidence at startup, close and daily-mode restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-hourly-evidence-"));
  const database = join(directory, "state.sqlite");
  const count = PAPER_FORWARD_EVIDENCE_DEFAULT_POLICY.minimumLongitudinalPeriods * 24;
  let handle;
  try {
    seedHourlyPeriods(database, count);
    handle = startCloudRuntime(env(database, 42983));
    assert.equal(handle.listPaperRealizedPeriods().length, count, "startup must not prune the hourly horizon to100");
    const start = BASE + count * 3_600_000;
    const next = { ...PLAN, periodId: "post-horizon-period", periodIndex: count, periodStartAt: start };
    handle.openPaperRealizedPeriod(next);
    handle.observePaperRealizedExecution({ observationId: "post-horizon-observation", observedAt: start + 1, status: "REJECTED" });
    handle.closePaperRealizedPeriod({ ...CLOSE, envelope: { ...CLOSE.envelope, record: {
      ...CLOSE.envelope.record, recordId: next.periodId, periodIndex: count, periodStartAt: start, periodEndAt: start + 3_600_000,
      status: "REJECTED", costEvidence: { ...CLOSE.envelope.record.costEvidence, observedAt: start + 1 },
    } } });
    assert.equal(handle.listPaperRealizedPeriods().length, count + 1, "close must retain prior evidence and rejected outcome");
    await handle.stop(); handle = undefined;
    handle = startCloudRuntime({ ...env(database, 42983), NUSA_CLOSED_LEARNING_EVALUATION_PERIOD_MS: "86400000" });
    const retained = handle.listPaperRealizedPeriods();
    assert.equal(retained.length, count + 1);
    assert.equal(retained[0].record.recordId, "hourly-0");
    assert.equal(retained.at(-1).record.status, "REJECTED");
  } finally {
    if (handle) await handle.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Cloud realized evidence stays bounded at1000 without selecting only successful periods", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-hourly-evidence-cap-"));
  const database = join(directory, "state.sqlite");
  let handle;
  try {
    seedHourlyPeriods(database, 1_001);
    const db = new SqliteDatabase(database);
    try {
      const repository = new SqlitePaperRealizedPeriodRepository(db);
      const start = BASE + 1_001 * 3_600_000;
      repository.append({ ...CLOSE.envelope, record: { ...CLOSE.envelope.record,
        recordId: "halted-newest", periodIndex: 1_001, periodStartAt: start, periodEndAt: start + 3_600_000,
        status: "HALTED", costEvidence: { ...CLOSE.envelope.record.costEvidence, observedAt: start + 1 },
      } });
    } finally { db.close(); }
    handle = startCloudRuntime(env(database, 42984));
    const retained = handle.listPaperRealizedPeriods();
    assert.equal(retained.length, 1_000);
    assert.equal(retained[0].record.recordId, "hourly-2");
    assert.equal(retained.at(-1).record.status, "HALTED");
  } finally {
    if (handle) await handle.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

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
    assert.deepEqual(handle.closePaperRealizedPeriod({ envelope: { record: { recordId: "runtime-observed-period", periodIndex: 0, advisory: observedAdvisory, periodStartAt, periodEndAt: Date.now(), realizedReturns: { "candidate-a": 0 }, benchmarkReturn: 0, turnoverCostRate: 0, costEvidence: { evidenceId: "cost-runtime-observed", source: "PAPER_EXECUTION_RECEIPT", evidenceKind: "CONSERVATIVE_MODEL", evidenceFingerprintSha256: "a".repeat(64), observedAt: periodStartAt + 1, feeRate: 0.0005, spreadRate: 0, slippageRate: 0 }, status: "COMPLETED" }, candidateProvenance: PROVENANCE } }).record.recordId, "runtime-observed-period");
    assert.equal(open.length, 0);
  } finally {
    if (handle) await handle.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
