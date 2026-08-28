const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");

const BASE = 1_800_000_000_000;
const HASH = "a".repeat(64);
const PLAN = { periodId: "runtime-period", periodIndex: 0, candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH, advisoryGeneratedAt: BASE - 100, periodStartAt: BASE };
const CLOSE = { periodId: PLAN.periodId, periodEndAt: BASE + 900, grossReturn: 0.01, turnover: 1, feeRate: 0.001, spreadRate: 0, slippageRate: 0, status: "COMPLETED" };

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
    assert.deepEqual(first.closePaperRealizedPeriod(CLOSE), { ...CLOSE, candidateId: PLAN.candidateId, datasetId: PLAN.datasetId, datasetContentSha256: HASH, advisoryGeneratedAt: PLAN.advisoryGeneratedAt, periodStartAt: PLAN.periodStartAt });
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
    handle.openPaperRealizedPeriod({ periodId: "runtime-observed-period", periodIndex: 0, candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH, advisoryGeneratedAt: periodStartAt - 100, periodStartAt });
    onTicker({ type: "ticker", code: "KRW-BTC", trade_price: 50_000, trade_timestamp: periodStartAt, signed_change_rate: 0.03, acc_trade_price_24h: 1_000_000_000 });
    assert.equal(handle.listPaperRealizedPeriods().length, 0);
    const open = handle.listPaperRealizedPeriods();
    assert.deepEqual(handle.closePaperRealizedPeriod({ periodId: "runtime-observed-period", periodEndAt: Date.now(), grossReturn: 0, turnover: 0, feeRate: 0.0005, spreadRate: 0, slippageRate: 0, status: "COMPLETED" }).periodId, "runtime-observed-period");
    assert.equal(open.length, 0);
  } finally {
    if (handle) await handle.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
