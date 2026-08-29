const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { SqliteDatabase, SqliteResearchEvaluationLedger, SqliteCandidatePromotionRepository, SqliteResearchMemoryRepository, SqliteResearchSessionRepository } = require("../dist/packages/storage/src/index.js");
const { ResearchRuntimeCoordinator } = require("../dist/apps/cloud/src/researchRuntimeCoordinator.js");
const { ResearchRecoveryCoordinator } = require("../dist/apps/cloud/src/researchRecoveryCoordinator.js");
const { CandidatePromotionRuntime } = require("../dist/apps/cloud/src/candidatePromotionRuntime.js");
const { ResearchAutomationRuntime } = require("../dist/apps/cloud/src/researchAutomationRuntime.js");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");
const { InMemoryCloudDashboardStateProvider } = require("../dist/apps/cloud/src/cloudDashboardStateProvider.js");
const { canonicalResearchJson } = require("../dist/packages/contracts/src/researchRuntime.js");
const { mkdtempSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const NOW = 2_000;
const hash = (value) => crypto.createHash("sha256").update(canonicalResearchJson(value)).digest("hex");
const input = (sessionId, evaluationId, overrides = {}) => ({
  researchRunId: sessionId,
  evaluationId,
  strategyId: "family-1",
  strategyVersion: "comparison-1",
  marketDataTimestamp: 1_850,
  evaluationTimestamp: 1_900,
  modelVersion: "model-1",
  fillModelVersion: "fill-1",
  feeModelVersion: "fee-1",
  slippageModelVersion: "slip-1",
  strategyState: "RESEARCHING",
  staleWindowMs: 30_000,
  marketData: [{ market: "KRW-BTC", price: 100, observedAt: 1_800 }, { market: "KRW-BTC", price: 101, observedAt: 1_850 }],
  startingCash: 1_000_000,
  startingPositionQuantity: 0,
  ...overrides
});
const evaluator = (strategyId, strategyVersion, authority, netReturn) => ({
  strategyId, strategyVersion, authority, evaluatorVersion: `${strategyId}-evaluator-1`,
  evaluate(context) { return { strategyId, strategyVersion, authority, evaluatorVersion: `${strategyId}-evaluator-1`, canonicalInputHash: context.canonicalInputHash, metrics: { netReturn, maxDrawdown: -0.01 }, signal: "HOLD" }; }
});
const startInput = (sessionId, maxExperiments = 5) => ({ sessionId, datasetId: "dataset-1", interval: "1m", championStrategyId: "champion-1", championStrategyVersion: "1.0.0", challengerStrategyId: "challenger-1", challengerStrategyVersion: "2.0.0", deterministicConfig: { fill: "fill-1", fee: "fee-1", slippage: "slip-1" }, maxExperiments });

function setup(filename = ":memory:") {
  const db = new SqliteDatabase(filename);
  const ledger = new SqliteResearchEvaluationLedger(db);
  const candidates = new SqliteCandidatePromotionRepository(db);
  const memory = new SqliteResearchMemoryRepository(db);
  const sessions = new SqliteResearchSessionRepository(db);
  const promotion = new CandidatePromotionRuntime({ repository: candidates, evaluationLedger: ledger, ownerActorRefs: ["owner"], now: () => NOW });
  const coordinator = new ResearchRuntimeCoordinator({ champion: evaluator("champion-1", "1.0.0", "PAPER_ONLY", 0.1), challenger: evaluator("challenger-1", "2.0.0", "ZERO_AUTHORITY", 0.2), ledger });
  const recovery = new ResearchRecoveryCoordinator({ repository: candidates, evaluationLedger: ledger, now: () => NOW });
  const automation = new ResearchAutomationRuntime({ coordinator, sessions, memory, registerCandidate: (identity) => promotion.registerCandidate(identity), listCandidates: () => candidates.listCandidates(), recovery, now: () => NOW, maxEvidenceAgeMs: 10_000 });
  return { db, ledger, candidates, memory, sessions, promotion, coordinator, recovery, automation };
}

test("session starts with bounded PAPER research state and persists", () => {
  const state = setup();
  try { const session = state.automation.startSession(startInput("session-1")); assert.equal(session.state, "RUNNING"); assert.equal(session.maxExperiments, 5); assert.equal(state.sessions.load("session-1").deterministicConfigHash.length, 64); assert.equal(state.automation.status("session-1").champion.authority, "PAPER_ONLY"); assert.equal(state.automation.status("session-1").challenger.authority, "ZERO_AUTHORITY"); } finally { state.db.close(); }
});

test("hypothesis memory is linked to the persisted experiment chain", () => {
  const state = setup();
  try { state.automation.startSession({ ...startInput("session-memory"), hypothesis: { id: "hypothesis-1", title: "Test hypothesis", statement: "A deterministic test hypothesis", status: "ACTIVE", createdAt: new Date(NOW).toISOString() } }); state.automation.runExperiment(input("session-memory", "evaluation-memory")); const experiment = state.memory.listExperiments()[0]; assert.equal(experiment.hypothesisId, "hypothesis-1"); assert.equal(state.memory.getHypothesis("hypothesis-1").status, "ACTIVE"); } finally { state.db.close(); }
});

test("multiple experiments flow through evaluation ledger and memory while strict candidate evidence remains gated", () => {
  const state = setup();
  try { state.automation.startSession(startInput("session-1")); const first = state.automation.runExperiment(input("session-1", "evaluation-1")); const second = state.automation.runExperiment(input("session-1", "evaluation-2", { marketDataTimestamp: 1_860 })); assert.equal(first.result, "CHALLENGER_BETTER"); assert.equal(second.result, "CHALLENGER_BETTER"); assert.equal(state.ledger.list().length, 2); assert.equal(state.memory.listExperiments().length, 2); assert.equal(state.candidates.listCandidates().length, 0); const status = state.automation.status("session-1"); assert.equal(status.experimentCount, 2); assert.equal(status.metrics.challengerBetterCount, 2); assert.equal(status.metrics.positiveEvaluationCount, 2); assert.equal(status.health, "HEALTHY"); } finally { state.db.close(); }
});

test("missing explicit cost evidence is not counted as cost-adjusted performance", () => {
  const state = setup();
  try { state.automation.startSession(startInput("session-cost")); state.automation.runExperiment(input("session-cost", "evaluation-cost")); const metrics = state.automation.status("session-cost").metrics; assert.equal(metrics.costAdjustedPerformance, undefined); assert.equal(metrics.costAdjustedEvidenceCount, 0); assert.equal(metrics.missingCostEvidenceCount, 1); } finally { state.db.close(); }
});

test("candidate registration requires the hardened evidence gate and never promotes", () => {
  const state = setup();
  try { state.automation.startSession(startInput("session-1")); state.automation.runExperiment(input("session-1", "evaluation-1")); assert.equal(state.automation.runExperiment(input("session-1", "evaluation-1")).evaluationId, "evaluation-1"); assert.equal(state.candidates.listCandidates().length, 0); assert.equal(state.candidates.getChampion(), null); assert.equal(state.candidates.listAudit().length, 0); } finally { state.db.close(); }
});

test("inconclusive evaluations aggregate safely and stale evidence is observable", () => {
  const state = setup();
  try { state.automation.startSession(startInput("session-1")); state.automation.runExperiment(input("session-1", "evaluation-1", { marketData: [] })); const status = state.automation.status("session-1"); assert.equal(status.lastResult, "INCONCLUSIVE"); assert.equal(status.metrics.inconclusiveCount, 1); assert.equal(status.health, "DEGRADED"); } finally { state.db.close(); }
});

test("evidence age transitions a healthy session to STALE without changing authority", () => {
  let now = NOW;
  const state = setup();
  state.automation = new ResearchAutomationRuntime({ coordinator: state.coordinator, sessions: state.sessions, memory: state.memory, registerCandidate: (identity) => state.promotion.registerCandidate(identity), listCandidates: () => state.candidates.listCandidates(), recovery: state.recovery, now: () => now, maxEvidenceAgeMs: 100 });
  try { state.automation.startSession(startInput("session-age")); state.automation.runExperiment(input("session-age", "evaluation-age")); assert.equal(state.automation.status("session-age").health, "HEALTHY"); now = 2_500; const status = state.automation.status("session-age"); assert.equal(status.health, "STALE"); assert.equal(status.liveAuthority, "NONE"); assert.equal(status.productionMutationAllowed, false); } finally { state.db.close(); }
});

test("resource limit completes a session and prevents unbounded orchestration", () => {
  const state = setup();
  try { state.automation.startSession(startInput("session-1", 1)); state.automation.runExperiment(input("session-1", "evaluation-1")); assert.equal(state.sessions.load("session-1").state, "COMPLETED"); assert.throws(() => state.automation.runExperiment(input("session-1", "evaluation-2")), /research session is not running/); } finally { state.db.close(); }
});

test("restart pauses incomplete sessions and restores identical evidence without promotion", () => {
  const filename = join(mkdtempSync(join(tmpdir(), "nusa-research-automation-")), "research.db");
  const first = setup(filename);
  first.automation.startSession(startInput("session-1"));
  first.automation.runExperiment(input("session-1", "evaluation-1"));
  first.db.close();
  const second = setup(filename);
  try { const result = second.automation.recover(); assert.equal(result.status, "READY"); assert.equal(second.sessions.load("session-1").state, "PAUSED"); const status = second.automation.status("session-1"); assert.equal(status.recoveryStatus, "PAUSED"); assert.equal(status.experimentCount, 1); assert.equal(second.candidates.getChampion(), null); assert.equal(second.ledger.list().length, 1); second.automation.resume("session-1"); assert.equal(second.automation.runExperiment(input("session-1", "evaluation-1")).evaluationId, "evaluation-1"); assert.equal(second.ledger.list().length, 1); } finally { second.db.close(); }
});

test("recovery failure halts sessions and blocks resume", () => {
  const state = setup();
  try { state.automation.startSession(startInput("session-1")); state.automation.runExperiment(input("session-1", "evaluation-1")); state.db.connection.prepare("UPDATE research_evaluation_ledger SET hash = ?").run("f".repeat(64)); const result = state.automation.recover(); assert.equal(result.status, "FAIL_CLOSED"); assert.equal(state.sessions.load("session-1").state, "HALTED"); assert.equal(state.automation.status("session-1").health, "FAIL_CLOSED"); assert.throws(() => state.automation.resume("session-1"), /fail-closed/); } finally { state.db.close(); }
});

test("memory persistence failure fails the session without rewriting prior evaluation evidence", () => {
  const state = setup();
  try { state.automation.startSession(startInput("session-1")); state.memory.appendExperiment = () => { throw new Error("memory unavailable"); }; assert.throws(() => state.automation.runExperiment(input("session-1", "evaluation-1")), /memory unavailable/); assert.equal(state.sessions.load("session-1").state, "FAILED"); assert.equal(state.ledger.list().length, 1); } finally { state.db.close(); }
});

test("cloud market-data wiring invokes the research-only hook and never grants LIVE authority", async () => {
  const provider = new InMemoryCloudDashboardStateProvider();
  let onTicker; let stopped = false; let calls = 0;
  const automation = { recover: () => ({ status: "READY", snapshot: null, reasons: [] }), onMarketData(tick) { assert.equal(tick.market, "KRW-BTC"); calls += 1; } };
  const factory = (markets, callback) => { assert.deepEqual(markets, ["KRW-BTC"]); onTicker = callback; return { subscribe() {}, start() {}, stop() { stopped = true; } }; };
  const handle = startCloudRuntime({ NUSA_CLOUD_DASHBOARD_PORT: "41929", NUSA_CLOUD_DASHBOARD_TOKEN: "research-runtime-test-token-at-least-32-bytes", NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true", NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC" }, provider, undefined, factory, undefined, undefined, undefined, undefined, undefined, automation);
  try { onTicker({ type: "ticker", code: "KRW-BTC", trade_price: 100, signed_change_rate: 0.01, acc_trade_price_24h: 1000, trade_timestamp: Date.now() }); assert.equal(calls, 1); assert.equal(automation.liveAuthority, undefined); } finally { await handle.stop(); assert.equal(stopped, true); }
});
