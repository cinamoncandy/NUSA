const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const { SqliteDatabase, SqliteResearchEvaluationLedger, SqliteCandidatePromotionRepository, SqliteResearchMemoryRepository, SqliteResearchSessionRepository, SqliteResearchCandleStore, SqliteResearchHoldoutLedger } = require("../dist/packages/storage/src/index.js");
const { ResearchRuntimeCoordinator } = require("../dist/apps/cloud/src/researchRuntimeCoordinator.js");
const { ResearchRecoveryCoordinator } = require("../dist/apps/cloud/src/researchRecoveryCoordinator.js");
const { CandidatePromotionRuntime } = require("../dist/apps/cloud/src/candidatePromotionRuntime.js");
const { ResearchAutomationRuntime } = require("../dist/apps/cloud/src/researchAutomationRuntime.js");
const { BacktestResearchEvaluator, buildSmaResearchStrategy } = require("../dist/apps/cloud/src/backtestResearchEvaluator.js");
const { ResearchExperimentOrchestrator } = require("../dist/apps/cloud/src/researchExperimentOrchestrator.js");

const M = 60_000;
const DAY = 86_400_000;
const T_END = Date.UTC(2026, 9, 2, 3, 0, 0); // 2026-10-02 12:00 KST, a multiple of one minute
const BACKTEST = { initialCash: 1_000_000, feeRate: 0.0005, slippageBps: 5 };
const WINDOWS = { intervalMs: M, trainMs: 200 * M, validationMs: 80 * M, holdoutMs: 80 * M, maxMissingRatio: 0 };

function candles(count, endCloseMs) {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + 12 * Math.sin(i / 6) + (i % 7) * 0.3;
    return { closeTimeMs: endCloseMs - (count - 1 - i) * M, open: close, high: close + 1, low: close - 1, close: Number(close.toFixed(4)) };
  });
}
const strat = (id, fast, slow) => buildSmaResearchStrategy({ strategyId: id, version: "1.0.0", market: "KRW-BTC", fastPeriod: fast, slowPeriod: slow, takeProfitPercent: 4, stopLossPercent: 2, positionPercent: 50, maxPositionNotional: 500_000 });

function build(filename, state = { now: T_END }) {
  const db = new SqliteDatabase(filename);
  const store = new SqliteResearchCandleStore(db);
  const holdout = new SqliteResearchHoldoutLedger(db);
  const ledger = new SqliteResearchEvaluationLedger(db);
  const candidates = new SqliteCandidatePromotionRepository(db);
  const memory = new SqliteResearchMemoryRepository(db);
  const sessions = new SqliteResearchSessionRepository(db);
  const promotion = new CandidatePromotionRuntime({ repository: candidates, evaluationLedger: ledger, ownerActorRefs: ["owner"], now: () => state.now });
  const recovery = new ResearchRecoveryCoordinator({ repository: candidates, evaluationLedger: ledger, now: () => state.now });
  const champion = strat("champion-sma", 3, 8);
  const mkVariant = (variantId, fast, slow) => {
    const challenger = strat(`challenger-${variantId}`, fast, slow);
    const mk = (strategy, authority) => new BacktestResearchEvaluator({ strategyId: strategy.strategyId, strategyVersion: strategy.version, authority, evaluatorVersion: "backtest-eval-v1", strategy, candles: store, intervalMs: M, backtest: BACKTEST });
    const coordinator = new ResearchRuntimeCoordinator({ champion: mk(champion, "PAPER_ONLY"), challenger: mk(challenger, "ZERO_AUTHORITY"), ledger });
    const runtime = new ResearchAutomationRuntime({ coordinator, sessions, memory, registerCandidate: (identity) => promotion.registerCandidate(identity), listCandidates: () => candidates.listCandidates(), recovery, now: () => state.now, maxEvidenceAgeMs: 30 * DAY });
    return { variantId, champion: { strategy: champion, config: { fast: 3, slow: 8 } }, challenger: { strategy: challenger, config: { fast: fast, slow } }, runtime };
  };
  const orchestrator = new ResearchExperimentOrchestrator({
    variants: [mkVariant("v1", 5, 12), mkVariant("v2", 4, 16)], sessions, markets: ["KRW-BTC"], intervalMs: M, windows: WINDOWS, dailyBudgetPerVariant: 20,
    collect: () => {}, candles: store, holdout, now: () => state.now, sourceCommitSha: "a".repeat(40),
    models: { fill: "fill-close-v1", fee: "fee-0.0005-v1", slippage: "slip-5bps-v1" }, evaluator: { version: "backtest-eval-v1", modelVersion: "dsl-backtest-v1" },
    featurePipeline: { version: "closed-candle-agg-v1", config: { intervalMs: M } }, experimentFamilyPrefix: "sma-family",
  });
  return { db, store, sessions, orchestrator, holdout, state };
}
const fresh = () => join(mkdtempSync(join(tmpdir(), "nusa-orch-")), "o.db");
const seed = (s, count = 400, end = T_END) => s.store.append("KRW-BTC", M, candles(count, end));
const dayKey = (ms) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);

test("does nothing until recovery is ready, then starts one session per variant and runs experiments", () => {
  const s = build(fresh()); seed(s);
  try {
    assert.equal(s.orchestrator.tick().status, "RECOVERY_NOT_READY");
    assert.equal(s.sessions.list().length, 0);
    assert.equal(s.orchestrator.recover().status, "READY");
    const report = s.orchestrator.tick();
    assert.equal(report.status, "OK");
    assert.equal(report.started, 2);
    assert.deepEqual(s.sessions.list().map((x) => x.sessionId), [`research-${dayKey(T_END)}-v1`, `research-${dayKey(T_END)}-v2`]);
    assert.equal(report.experiments.length, 2);
    for (const e of report.experiments) assert.equal(e.outcome.status, "COMPLETED", JSON.stringify(e));
    const projection = s.orchestrator.statusProjection();
    assert.ok(projection != null && projection.experimentCount >= 1);
    assert.equal(projection.liveAuthority, "NONE");
    assert.equal(projection.challenger.authority, "ZERO_AUTHORITY");
  } finally { s.db.close(); }
});

test("a second tick on the same data does not repeat the experiment", () => {
  const s = build(fresh()); seed(s);
  try {
    s.orchestrator.recover();
    s.orchestrator.tick();
    const before = s.sessions.list().map((x) => x.experimentCount);
    const again = s.orchestrator.tick();
    assert.equal(again.started, 0);
    for (const e of again.experiments) assert.equal(e.outcome.status, "NOT_DUE");
    assert.deepEqual(s.sessions.list().map((x) => x.experimentCount), before);
  } finally { s.db.close(); }
});

test("after a restart the paused session resumes and keeps working without duplicating", () => {
  const file = fresh();
  const first = build(file); seed(first);
  first.orchestrator.recover(); first.orchestrator.tick();
  const counts = first.sessions.list().map((x) => x.experimentCount);
  first.db.close();
  const second = build(file);
  try {
    assert.equal(second.orchestrator.recover().status, "READY");
    assert.ok(second.sessions.list().every((x) => x.state === "PAUSED"));
    const report = second.orchestrator.tick();
    assert.equal(report.resumed, 2);
    assert.equal(report.started, 0);
    assert.ok(second.sessions.list().every((x) => x.state === "RUNNING"));
    assert.deepEqual(second.sessions.list().map((x) => x.experimentCount), counts);
  } finally { second.db.close(); }
});

test("a new trading day stops the previous RUNNING sessions and starts new ones", () => {
  const s = build(fresh()); seed(s, 400, T_END);
  try {
    s.orchestrator.recover(); s.orchestrator.tick();
    s.state.now = T_END + DAY;
    seed(s, 400, T_END + DAY);
    const report = s.orchestrator.tick();
    assert.equal(report.stopped, 2);
    assert.equal(report.started, 2);
    const states = Object.fromEntries(s.sessions.list().map((x) => [x.sessionId, x.state]));
    assert.equal(states[`research-${dayKey(T_END)}-v1`], "COMPLETED");
    assert.equal(states[`research-${dayKey(T_END + DAY)}-v1`], "RUNNING");
  } finally { s.db.close(); }
});

test("without enough candles the sessions start but experiments are skipped with a stable reason", () => {
  const s = build(fresh()); seed(s, 50);
  try {
    s.orchestrator.recover();
    const report = s.orchestrator.tick();
    assert.equal(report.started, 2);
    for (const e of report.experiments) { assert.equal(e.outcome.status, "SKIPPED"); assert.match(e.outcome.reason, /^WINDOWS_/); }
  } finally { s.db.close(); }
});

test("market data ticks are ignored by design and an empty status projection is null", () => {
  const s = build(fresh());
  try {
    assert.equal(s.orchestrator.onMarketData({ market: "KRW-BTC", price: 1, observedAt: 1, now: 1 }), undefined);
    assert.equal(s.orchestrator.statusProjection(), null);
  } finally { s.db.close(); }
});

test("invalid orchestrator configuration is rejected", () => {
  const s = build(fresh());
  try {
    const base = { variants: [], sessions: s.sessions, markets: ["KRW-BTC"], intervalMs: M, windows: WINDOWS, dailyBudgetPerVariant: 1, collect: () => {}, candles: s.store, holdout: s.holdout, now: () => T_END, sourceCommitSha: "a".repeat(40), models: {}, evaluator: {}, featurePipeline: {}, experimentFamilyPrefix: "x" };
    assert.throws(() => new ResearchExperimentOrchestrator(base));
  } finally { s.db.close(); }
});
