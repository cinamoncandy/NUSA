const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const { SqliteDatabase, SqliteResearchCandleStore } = require("../dist/packages/storage/src/index.js");
const { composeResearchExperiments, readResearchExperimentSettings, RESEARCH_FLAG, RESEARCH_BACKTEST_COST } = require("../dist/apps/cloud/src/researchExperimentComposition.js");

const M = 60_000;
const SHA = "b".repeat(40);
const T_END = Date.UTC(2026, 9, 2, 3, 0, 0);
const env = (over = {}) => ({ [RESEARCH_FLAG]: "1", NUSA_SOURCE_COMMIT_SHA: SHA, ...over });
const open = () => new SqliteDatabase(join(mkdtempSync(join(tmpdir(), "nusa-compose-")), "c.db"));

test("disabled by default: no flag, or any value other than exactly 1, composes nothing and says nothing", () => {
  const db = open();
  const lines = [];
  for (const value of [undefined, "", "0", "true", "yes", " 1", "11"]) {
    assert.equal(composeResearchExperiments({ env: { [RESEARCH_FLAG]: value, NUSA_SOURCE_COMMIT_SHA: SHA }, database: db, log: (l) => lines.push(l) }), undefined, String(value));
  }
  assert.deepEqual(lines, []);
  assert.equal(readResearchExperimentSettings({}).status, "DISABLED");
  db.close();
});

test("enabled but misconfigured stays disabled with one reason (fail closed)", () => {
  const db = open();
  const cases = [
    [env({ NUSA_SOURCE_COMMIT_SHA: "" }), "SOURCE_COMMIT_MISSING_OR_MALFORMED"],
    [env({ NUSA_SOURCE_COMMIT_SHA: "abc" }), "SOURCE_COMMIT_MISSING_OR_MALFORMED"],
    [env({ NUSA_SOURCE_COMMIT_SHA: "A".repeat(40) }), "SOURCE_COMMIT_MISSING_OR_MALFORMED"],
    [env({ NUSA_RESEARCH_MARKETS: "BTC-KRW" }), "MARKETS_INVALID"],
    [env({ NUSA_RESEARCH_MARKETS: "KRW-BTC,KRW-BTC" }), "MARKETS_INVALID"],
    [env({ NUSA_RESEARCH_MARKETS: "KRW-A,KRW-B,KRW-C,KRW-D,KRW-E,KRW-F" }), "MARKETS_INVALID"],
    [env({ NUSA_RESEARCH_TRAIN_DAYS: "0" }), "NUMERIC_SETTING_INVALID"],
    [env({ NUSA_RESEARCH_VALIDATION_DAYS: "1.5" }), "NUMERIC_SETTING_INVALID"],
    [env({ NUSA_RESEARCH_HOLDOUT_DAYS: "99" }), "NUMERIC_SETTING_INVALID"],
    [env({ NUSA_RESEARCH_TICK_MINUTES: "1" }), "NUMERIC_SETTING_INVALID"],
    [env({ NUSA_RESEARCH_DAILY_BUDGET: "1000" }), "NUMERIC_SETTING_INVALID"],
  ];
  for (const [e, reason] of cases) {
    const lines = [];
    assert.equal(composeResearchExperiments({ env: e, database: db, log: (l) => lines.push(l) }), undefined);
    assert.deepEqual(lines, [`[research-experiments] disabled: ${reason}`], reason);
  }
  db.close();
});

test("valid settings use the documented defaults and explicit cost assumptions", () => {
  const r = readResearchExperimentSettings(env());
  assert.equal(r.status, "ENABLED");
  assert.deepEqual([...r.settings.markets], ["KRW-BTC"]);
  assert.deepEqual({ ...r.settings.windows }, { intervalMs: M, trainMs: 7 * 86_400_000, validationMs: 2 * 86_400_000, holdoutMs: 2 * 86_400_000, maxMissingRatio: 0.05 });
  assert.equal(r.settings.tickMs, 30 * M);
  assert.equal(r.settings.dailyBudgetPerVariant, 48);
  assert.deepEqual({ ...RESEARCH_BACKTEST_COST }, { initialCash: 1_000_000, feeRate: 0.0005, slippageBps: 5 });
});

test("enabled composition recovers, runs a real tick on stored candles and exposes the status the app reads", () => {
  const db = open();
  const store = new SqliteResearchCandleStore(db, 200_000);
  const days = 11; const count = days * 1440;
  const rows = Array.from({ length: count }, (_, i) => { const close = Number((100 + 15 * Math.sin(i / 90) + (i % 11) * 0.2).toFixed(4)); return { closeTimeMs: T_END - (count - 1 - i) * M, open: close, high: close + 1, low: close - 1, close }; });
  store.append("KRW-BTC", M, rows);
  const lines = [];
  const composition = composeResearchExperiments({ env: env({ NUSA_RESEARCH_DAILY_BUDGET: "10" }), database: db, now: () => T_END, log: (l) => lines.push(l) });
  try {
    assert.ok(composition);
    assert.equal(composition.orchestrator.recover().status, "READY");
    const report = composition.tickOnce();
    assert.equal(report.status, "OK");
    assert.equal(report.started, 4);
    assert.equal(report.experiments.length, 4);
    for (const e of report.experiments) assert.equal(e.outcome.status, "COMPLETED", JSON.stringify(e));
    const projection = composition.orchestrator.statusProjection();
    assert.ok(projection != null && projection.experimentCount >= 1);
    assert.equal(projection.liveAuthority, "NONE");
    assert.equal(projection.productionMutationAllowed, false);
    assert.equal(projection.champion.authority, "PAPER_ONLY");
    assert.equal(projection.challenger.authority, "ZERO_AUTHORITY");
    assert.ok(lines.some((l) => l.startsWith("[research-experiments] tick OK started=4")));
    const again = composition.tickOnce();
    assert.equal(again.started, 0);
  } finally { composition.stop(); db.close(); }
});

test("start and stop manage timers without leaking and stop is idempotent", () => {
  const db = open();
  const composition = composeResearchExperiments({ env: env(), database: db, log: () => {} });
  composition.start();
  composition.start();
  composition.stop();
  composition.stop();
  db.close();
});
