const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");

const BASE = 1_800_000_000_000;
const HASH = "a".repeat(64);
const PLAN = { periodId: "runtime-period", periodIndex: 0, candidateId: "candidate-a", datasetId: "dataset-a", datasetContentSha256: HASH, advisoryGeneratedAt: BASE - 100, periodStartAt: BASE };

function env(path, port) {
  return { NUSA_CLOUD_STATE_DB_PATH: path, NUSA_CLOUD_DASHBOARD_PORT: String(port), NUSA_CLOUD_DASHBOARD_TOKEN: ["runtime", "paper", "period", "fixture", "0123456789"].join("-"), NUSA_CLOUD_UPBIT_PUBLIC_DATA: "false" };
}

function legacyDisabled(error) {
  return error && error.code === "NON_CANONICAL_LEGACY_PRODUCER_DISABLED";
}

test("production startCloudRuntime refuses the retired caller-supplied PAPER period writer", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-paper-period-runtime-retired-"));
  const database = join(directory, "state.sqlite");
  let handle;
  try {
    handle = startCloudRuntime(env(database, 42981));
    assert.throws(() => handle.openPaperRealizedPeriod(PLAN), legacyDisabled);
    assert.throws(() => handle.closePaperRealizedPeriod({ periodId: PLAN.periodId, periodEndAt: BASE + 900, grossReturn: 1, turnover: 0, feeRate: 0, spreadRate: 0, slippageRate: 0, status: "COMPLETED" }), legacyDisabled);
    assert.deepEqual(handle.listPaperRealizedPeriods(), []);
  } finally {
    if (handle) await handle.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production PAPER ticks do not write observations into the retired realized-period path", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-paper-period-runtime-no-legacy-write-"));
  const database = join(directory, "state.sqlite");
  let handle;
  try {
    let onTicker;
    const marketFactory = (_markets, tickerCallback) => { onTicker = tickerCallback; return { subscribe() {}, start() {}, stop() {} }; };
    const runtimeEnv = { ...env(database, 42982), NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true", NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC", NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "10000000", NUSA_CLOUD_PAPER_INVESTMENT_PERCENT: "10" };
    handle = startCloudRuntime(runtimeEnv, undefined, undefined, marketFactory);
    const periodStartAt = Date.now() - 1_000;
    assert.throws(() => handle.openPaperRealizedPeriod({ ...PLAN, periodId: "runtime-observed-period", advisoryGeneratedAt: periodStartAt - 100, periodStartAt }), legacyDisabled);
    onTicker({ type: "ticker", code: "KRW-BTC", trade_price: 50_000, trade_timestamp: periodStartAt, signed_change_rate: 0.03, acc_trade_price_24h: 1_000_000_000 });
    assert.equal(handle.observePaperRealizedExecution({ observationId: "explicit-observation", observedAt: Date.now(), status: "WAIT" }), "NO_ACTIVE_PERIOD");
    assert.deepEqual(handle.listPaperRealizedPeriods(), []);
  } finally {
    if (handle) await handle.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
