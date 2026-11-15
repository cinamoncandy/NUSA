"use strict";
// Canonical TradePermission enforcement at the Cloud PAPER execution boundary (#3108). A strategy order, new or continued,
// reaches the simulator only with an unexpired PERMIT bound to its intent, strategy, market, policy version and
// probability-model version, recomputed by the canonical engine from its evidence, with evidence confirmed by the trusted
// authority. Everything else is refused before the risk gate and the simulator; the permit is checked again right before
// the simulator.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { PaperTradingExecutionLoop, SqliteCloudPaperAccountRepository } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { CloudPaperExecutionBoundary } = require("../dist/apps/cloud/src/cloudPaperExecutionBoundary.js");
const { NO_PAPER_TRADE_PERMISSION_AUTHORITY, refusePaperTradePermission, PaperTradePermissionMemory } = require("../dist/apps/cloud/src/paperTradePermissionGuard.js");
const kit = require("../dist/apps/cloud/src/testing/paperTradePermissionTestKit.js");
const { buildPaperObservedExecutionQuote } = require("../dist/apps/cloud/src/paperRuntimeExecutionCostEvidence.js");

const candidateBinding = Object.freeze({
  schemaVersion: 1,
  status: "BOUND_UNVERIFIED",
  authority: "PAPER_RESEARCH_ONLY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  candidateId: "sma-5-20",
  datasetId: "restart-fixture-dataset",
  datasetContentSha256: "a".repeat(64),
  advisoryGeneratedAt: 500,
  periodStartAt: 900,
  advisoryFingerprintSha256: "b".repeat(64),
  bindingFingerprintSha256: "c".repeat(64),
  candidateStrategy: Object.freeze({
    candidateId: "sma-5-20",
    familyId: "sma-crossover",
    lineageId: "restart-fixture-lineage",
    specificationHash: "d".repeat(64),
    codeSha: "e".repeat(40),
    costModelVersion: "restart-cost-v1",
    parameters: Object.freeze({ shortPeriod: 5, longPeriod: 20 }),
  }),
});

const decision = Object.freeze({
  symbol: "KRW-BTC",
  action: "BUY",
  confidence: 1,
  risk: "LOW",
  allocation: 0.1,
  leverage: 1,
  score: 1,
  reasons: Object.freeze(["restart fixture"]),
  decidedAt: 1_000,
  paperCandidateBinding: candidateBinding,
  paperCandidateStrategyDecision: Object.freeze({
    action: "BUY",
    score: 1,
    confidence: 1,
    reason: "SMA_CROSSOVER:5/20:restart",
    observedAt: 950,
  }),
});

function tick(now, observedAt, price, decisions, observedQuote) {
  return Object.freeze({
    now,
    market: "KRW-BTC",
    price,
    observedAt,
    mode: "PAPER",
    killSwitchActive: false,
    tradingAllowed: true,
    overallHealth: "HEALTHY",
    portfolio: Object.freeze({
      allocations: Object.freeze([Object.freeze({
        symbol: "KRW-BTC",
        instrument: "SPOT",
        action: "BUY",
        capital: 1_000_000,
        share: 0.1,
        leverage: 1,
        confidence: 1,
        risk: "LOW",
      })]),
      deployedCapital: 1_000_000,
      cashCapital: 9_000_000,
      reservedCapital: 0,
      grossShare: 0.1,
      futuresShare: 0,
      decidedAt: 1_000,
    }),
    decisions: Object.freeze(decisions),
    observedQuote,
  });
}

function observedQuote(observedAt, askSize) {
  return buildPaperObservedExecutionQuote({
    market: "KRW-BTC",
    observedAt,
    totalAskSize: askSize,
    totalBidSize: 0.05,
    units: [Object.freeze({
      askPrice: 50_000_000,
      bidPrice: 49_000_000,
      askSize,
      bidSize: 0.05,
    })],
  });
}



/** An authority whose permits come from the real engine; `overrides` shapes the evidence, `edit` tampers with the record afterwards. */
const auth = (overrides = {}, hooks = {}) => ({
  policy: kit.testPermissionPolicy(overrides.policy),
  probabilityModelVersion: hooks.probabilityModelVersion ?? kit.TEST_MODEL_VERSION,
  latestPermit: (q) => { const r = kit.testRecord(q, overrides); return hooks.edit ? hooks.edit(r, q) : r; },
  evidenceExists: hooks.evidenceExists ?? (() => true),
  isLatest: hooks.isLatest ?? (() => true),
});

/** A durable permit ledger that outlives any boundary or process: what a real canonical authority must provide. */
const durableLedger = () => {
  const latest = new Map();
  return {
    publish: (record) => { latest.set(record.permit.decisionId, JSON.stringify(record.permit)); },
    isLatest: (record) => latest.get(record.permit.decisionId) === JSON.stringify(record.permit),
  };
};

function rig(authority, options = {}) {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, feeRate: 0, readP0State: () => ({ openP0: false }), ...(options.repository ? { repository: options.repository } : {}) });
  let riskCalls = 0;
  const queries = [];
  const wrapped = authority == null ? authority : { ...authority, latestPermit: (q) => { queries.push(q); return authority.latestPermit(q); } };
  const boundary = new CloudPaperExecutionBoundary({
    loop,
    tradePermissionAuthority: wrapped,
    riskGate: { evaluate() { riskCalls += 1; options.onRisk?.(); return Object.freeze({ status: "ALLOW", reasonCodes: Object.freeze([]) }); } },
    readP0State: () => ({ openP0: false }),
  });
  return { loop, boundary, riskCalls: () => riskCalls, queries };
}

const openTick = () => tick(2_000, 1_500, 50_000_000, [decision], observedQuote(1_900, 0.005));
const continuationTick = () => tick(2_200, 2_100, 50_000_000, [], observedQuote(2_150, 0.02));

const refusedNewOrder = (label, authority, reason) => test(`new strategy order is refused: ${label}`, () => {
  const r = rig(authority);
  const before = JSON.stringify(r.loop.snapshot());
  const result = r.boundary.processTick(openTick());
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, reason);
  assert.equal(r.riskCalls(), 0, "the risk gate is not even asked");
  assert.equal(JSON.stringify(r.loop.snapshot()), before, "no order, fill, ledger or state change");
  assert.equal(r.loop.snapshot().orders.length, 0);
  assert.equal((r.loop.snapshot().workingOrders ?? []).length, 0);
});

const ABSENT = "PAPER_TRADE_PERMISSION_ABSENT", NOT_PERMIT = "PAPER_TRADE_PERMISSION_NOT_PERMIT", MISMATCH = "PAPER_TRADE_PERMISSION_MISMATCH";
const INCOMPLETE = "PAPER_TRADE_PERMISSION_EVIDENCE_INCOMPLETE", UNVERIFIED = "PAPER_TRADE_PERMISSION_EVIDENCE_UNVERIFIED", TAMPERED = "PAPER_TRADE_PERMISSION_TAMPERED";
const EXPIRED = "PAPER_TRADE_PERMISSION_EXPIRED", BADTIME = "PAPER_TRADE_PERMISSION_INVALID_TIME", UNVERIFIABLE = "PAPER_TRADE_PERMISSION_UNVERIFIABLE", REPLAYED = "PAPER_TRADE_PERMISSION_REPLAYED";

refusedNewOrder("no authority configured (production default)", NO_PAPER_TRADE_PERMISSION_AUTHORITY, ABSENT);
refusedNewOrder("authority object missing", undefined, UNVERIFIABLE);
refusedNewOrder("authority throws", { ...auth(), latestPermit: () => { throw new Error("boom"); } }, UNVERIFIABLE);
refusedNewOrder("no permit for the query", { ...auth(), latestPermit: () => null }, ABSENT);
refusedNewOrder("empty policy version", auth({ policy: { policyVersion: " " } }), UNVERIFIABLE);
refusedNewOrder("explicit REJECT (governance not approved)", auth({ governanceApproved: false }), NOT_PERMIT);
refusedNewOrder("explicit REJECT (kill switch)", auth({ killSwitchActive: true }), NOT_PERMIT);
refusedNewOrder("explicit REJECT (risk budget used up, as right after a daily reset with a stale budget reading)", auth({ riskBudgetUsage: 0.95, policy: { maximumRiskBudgetUsage: 0.9 } }), "PAPER_TRADE_PERMISSION_NOT_PERMIT");
refusedNewOrder("expired", auth({ policy: { permissionTtlMs: 1_000 } }), EXPIRED);
refusedNewOrder("expires exactly now", auth({ policy: { permissionTtlMs: 2_000 } }), EXPIRED);
refusedNewOrder("generated in the future", auth({ generatedAt: "2050-01-01T00:00:00.000Z" }), BADTIME);
refusedNewOrder("other decision", auth({ decisionId: "paper-intent:other" }), MISMATCH);
refusedNewOrder("other strategy", auth({ strategyId: "other-candidate" }), MISMATCH);
refusedNewOrder("other market", auth({ market: "KRW-ETH" }), MISMATCH);
refusedNewOrder("authority requires another policy version than the permit carries", { ...auth(), policy: kit.testPermissionPolicy({ policyVersion: "newer-policy" }) }, MISMATCH);
refusedNewOrder("authority requires another probability model version", auth({}, { probabilityModelVersion: "newer-model" }), MISMATCH);
refusedNewOrder("no evidence references", auth({}, { edit: (r) => ({ input: r.input, permit: { ...r.permit, evidenceReferences: [] } }) }), INCOMPLETE);
refusedNewOrder("a gate missing from the evidence", auth({}, { edit: (r) => ({ input: r.input, permit: { ...r.permit, gates: r.permit.gates.slice(1), passedGates: r.permit.passedGates.slice(1) } }) }), INCOMPLETE);
refusedNewOrder("a failed gate listed on a PERMIT", auth({}, { edit: (r) => ({ input: r.input, permit: { ...r.permit, failedGates: ["GOVERNANCE"] } }) }), INCOMPLETE);
refusedNewOrder("a gate recorded as not passed on a PERMIT", auth({}, { edit: (r) => ({ input: r.input, permit: { ...r.permit, gates: r.permit.gates.map((g, i) => (i === 3 ? { ...g, passed: false } : g)) } }) }), INCOMPLETE);
// Provenance: the permit must be exactly what the canonical engine computes from the supplied evidence.
refusedNewOrder("permit lifetime extended by hand (tampered)", auth({ policy: { permissionTtlMs: 1_000 } }, { edit: (r) => ({ input: r.input, permit: { ...r.permit, expiresAt: "2099-01-01T00:00:00.000Z" } }) }), TAMPERED);
refusedNewOrder("a PERMIT whose evidence actually fails a gate (fabricated)", auth({}, { edit: (r) => ({ input: { ...r.input, governanceApproved: false }, permit: r.permit }) }), TAMPERED);
refusedNewOrder("a hand-made permit with all gates passed but different numbers", auth({}, { edit: (r) => ({ input: r.input, permit: { ...r.permit, gates: r.permit.gates.map((g) => ({ ...g, observedValue: 0 })) } }) }), TAMPERED);
refusedNewOrder("evidence the engine cannot even evaluate (invalid input behind a permit)", auth({}, { edit: (r) => ({ input: { ...r.input, dataQuality: 5 }, permit: r.permit }) }), TAMPERED);
refusedNewOrder("evidence input of another decision", auth({}, { edit: (r) => ({ input: { ...r.input, decisionId: "other" }, permit: r.permit }) }), MISMATCH);
refusedNewOrder("the durable store says the record is not the latest (replayed or superseded)", auth({}, { isLatest: () => false }), REPLAYED);
refusedNewOrder("the durable store cannot answer", auth({}, { isLatest: () => { throw new Error("db down"); } }), UNVERIFIABLE);
refusedNewOrder("the durable store answers with something other than true", auth({}, { isLatest: () => 1 }), REPLAYED);
refusedNewOrder("evidence references do not exist in the trusted store", auth({}, { evidenceExists: () => false }), UNVERIFIED);
refusedNewOrder("the evidence store throws", auth({}, { evidenceExists: () => { throw new Error("store down"); } }), UNVERIFIABLE);

test("a matching unexpired PERMIT reaches the existing path unchanged; the query carries the intent identity, candidate and market", () => {
  const r = rig(auth());
  const first = r.boundary.processTick(openTick());
  assert.equal(first.status, "WAIT");
  assert.equal(first.reason, "PAPER_STRATEGY_PARTIALLY_FILLED");
  assert.equal(r.riskCalls(), 1);
  assert.equal(r.queries.length, 2, "checked before the risk gate and again right before the simulator");
  assert.deepEqual(r.queries[0], r.queries[1]);
  assert.match(r.queries[0].decisionId, /^paper-intent:[a-f0-9]{64}$/);
  assert.equal(r.queries[0].strategyId, "sma-5-20");
  assert.equal(r.queries[0].market, "KRW-BTC");
  assert.equal(first.state.workingOrders[0].idempotencyKey, r.queries[0].decisionId, "the permit identity is the order identity");
});

test("no gap between lookup and use: a permit withdrawn while the risk gate runs stops the order before the simulator (new order and continuation)", () => {
  for (const phase of ["new", "continuation"]) {
    let withdrawn = false;
    const live = auth();
    const authority = { ...live, latestPermit: (q) => (withdrawn ? null : live.latestPermit(q)) };
    const r = rig(authority, { onRisk: () => { if (phase === "new" || r.loop.snapshot().workingOrders?.length) withdrawn = true; } });
    if (phase === "continuation") {
      assert.equal(r.boundary.processTick(openTick()).reason, "PAPER_STRATEGY_PARTIALLY_FILLED");
      withdrawn = false;
    }
    const before = JSON.stringify(r.loop.snapshot());
    const result = r.boundary.processTick(phase === "new" ? openTick() : continuationTick());
    assert.equal(result.status, "BLOCKED", phase);
    assert.equal(result.reason, ABSENT, phase);
    assert.equal(JSON.stringify(r.loop.snapshot()), before, `${phase}: the simulator was never reached`);
  }
});

test("in-process replay (second line of defence): an older record than one already accepted for the same intent is refused; the same or a newer one is accepted", () => {
  const q = { decisionId: "paper-intent:x", strategyId: "s", market: "KRW-BTC" };
  const memory = new PaperTradePermissionMemory();
  const at = (iso) => auth({ generatedAt: iso });
  assert.equal(refusePaperTradePermission(at("1970-01-01T00:00:10.000Z"), q, 20_000, memory), null);
  assert.equal(refusePaperTradePermission(at("1970-01-01T00:00:10.000Z"), q, 20_000, memory), null, "the same record again (idempotent)");
  assert.equal(refusePaperTradePermission(at("1970-01-01T00:00:15.000Z"), q, 20_000, memory), null, "a newer record");
  assert.equal(refusePaperTradePermission(at("1970-01-01T00:00:10.000Z"), q, 20_000, memory), REPLAYED, "the superseded older record");
  assert.equal(refusePaperTradePermission(at("1970-01-01T00:00:10.000Z"), { ...q, decisionId: "paper-intent:y" }, 20_000, memory), null, "memory is per intent");
});

test("duplicate permit: a permit issued for one intent is never accepted for another intent, market or strategy", () => {
  const first = rig(auth());
  assert.equal(first.boundary.processTick(openTick()).reason, "PAPER_STRATEGY_PARTIALLY_FILLED");
  const cached = kit.testRecord(first.queries[0]);
  const second = rig({ ...auth(), latestPermit: () => cached });
  const before = JSON.stringify(second.loop.snapshot());
  const result = second.boundary.processTick(tick(2_000, 1_500, 50_500_000, [decision], observedQuote(1_900, 0.005)));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, MISMATCH);
  assert.equal(JSON.stringify(second.loop.snapshot()), before);
  assert.equal(second.riskCalls(), 0);
});

test("a continued strategy working order needs a permit on every tick", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, feeRate: 0, readP0State: () => ({ openP0: false }) });
  const calls = { risk: 0 };
  const build = (authority) => new CloudPaperExecutionBoundary({
    loop, tradePermissionAuthority: authority, readP0State: () => ({ openP0: false }),
    riskGate: { evaluate() { calls.risk += 1; return Object.freeze({ status: "ALLOW", reasonCodes: Object.freeze([]) }); } },
  });
  const good = auth();
  assert.equal(build(good).processTick(openTick()).reason, "PAPER_STRATEGY_PARTIALLY_FILLED");
  const workingBefore = JSON.stringify(loop.snapshot());
  const riskBefore = calls.risk;
  const cases = [
    ["no authority", NO_PAPER_TRADE_PERMISSION_AUTHORITY, ABSENT],
    ["REJECT", auth({ governanceApproved: false }), NOT_PERMIT],
    ["expired", auth({ policy: { permissionTtlMs: 1_000 } }), EXPIRED],
    ["other strategy", auth({ strategyId: "x" }), MISMATCH],
    ["other decision", auth({ decisionId: "paper-intent:x" }), MISMATCH],
    ["other model", auth({}, { probabilityModelVersion: "m" }), MISMATCH],
    ["no evidence", auth({}, { edit: (r) => ({ input: r.input, permit: { ...r.permit, evidenceReferences: [] } }) }), INCOMPLETE],
    ["tampered", auth({ policy: { permissionTtlMs: 1_000 } }, { edit: (r) => ({ input: r.input, permit: { ...r.permit, expiresAt: "2099-01-01T00:00:00.000Z" } }) }), TAMPERED],
    ["evidence missing in the store", auth({}, { evidenceExists: () => false }), UNVERIFIED],
    ["throws", { ...good, latestPermit: () => { throw new Error("x"); } }, UNVERIFIABLE],
  ];
  for (const [label, authority, reason] of cases) {
    const result = build(authority).processTick(continuationTick());
    assert.equal(result.status, "BLOCKED", label);
    assert.equal(result.reason, reason, label);
    assert.equal(JSON.stringify(loop.snapshot()), workingBefore, `${label}: the working order and ledger are untouched`);
    assert.equal(calls.risk, riskBefore, `${label}: the risk gate is not asked`);
  }
  assert.equal(build(good).processTick(continuationTick()).status, "FILLED");
});

test("restart and restore: a working order restored from SQLite needs a valid permit on its first tick; stale, replayed or missing ones change nothing", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-permit-restore-"));
  const databasePath = path.join(directory, "state.sqlite");
  let db = new SqliteDatabase(databasePath);
  let repository = new SqliteCloudPaperAccountRepository(db);
  try {
    const loop = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, feeRate: 0, repository, readP0State: () => ({ openP0: false }) });
    const risk = { evaluate: () => Object.freeze({ status: "ALLOW", reasonCodes: Object.freeze([]) }) };
    const first = new CloudPaperExecutionBoundary({ loop, riskGate: risk, readP0State: () => ({ openP0: false }), tradePermissionAuthority: auth() });
    assert.equal(first.processTick(openTick()).reason, "PAPER_STRATEGY_PARTIALLY_FILLED");
    const fillsBefore = repository.loadFills().length;
    repository.close(); db.close();

    db = new SqliteDatabase(databasePath);
    repository = new SqliteCloudPaperAccountRepository(db);
    const restoredLoop = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, feeRate: 0, repository, readP0State: () => ({ openP0: false }) });
    assert.equal(restoredLoop.snapshot().workingOrders.length, 1);
    const stateBefore = JSON.stringify(restoredLoop.snapshot());
    const build = (authority) => new CloudPaperExecutionBoundary({ loop: restoredLoop, riskGate: risk, readP0State: () => ({ openP0: false }), tradePermissionAuthority: authority });
    for (const [label, authority, reason] of [
      ["no permit after the restart", NO_PAPER_TRADE_PERMISSION_AUTHORITY, ABSENT],
      ["an expired permit from before the restart", auth({ policy: { permissionTtlMs: 1_000 } }), EXPIRED],
      ["a permit for another intent", auth({ decisionId: "paper-intent:old" }), MISMATCH],
    ]) {
      const result = build(authority).processTick(continuationTick());
      assert.equal(result.status, "BLOCKED", label);
      assert.equal(result.reason, reason, label);
      assert.equal(JSON.stringify(restoredLoop.snapshot()), stateBefore, `${label}: restored state untouched`);
      assert.equal(repository.loadFills().length, fillsBefore, `${label}: no new fill is written`);
    }
    // Replay across the restart: the durable ledger holds a NEWER permit for this intent; the OLD permit presented by a fresh
    // boundary (no in-memory history at all) is refused, and the newer one continues the order.
    const ledger = durableLedger();
    const queryOf = () => { const q = restoredLoop.snapshot().workingOrders[0]; return { decisionId: q.idempotencyKey, strategyId: "sma-5-20", market: "KRW-BTC" }; };
    const oldRecord = kit.testRecord(queryOf(), { generatedAt: "1970-01-01T00:00:01.000Z" });
    const newRecord = kit.testRecord(queryOf(), { generatedAt: "1970-01-01T00:00:02.000Z" });
    ledger.publish(oldRecord); ledger.publish(newRecord);
    const withLedger = (record) => ({ ...auth(), latestPermit: () => record, isLatest: ledger.isLatest });
    const stale = build(withLedger(oldRecord)).processTick(continuationTick());
    assert.equal(stale.status, "BLOCKED");
    assert.equal(stale.reason, REPLAYED);
    assert.equal(JSON.stringify(restoredLoop.snapshot()), stateBefore, "the old permit changes nothing after the restart");
    assert.equal(repository.loadFills().length, fillsBefore);
    // Same time, different content for the same intent is a conflicting record, also refused within one boundary.
    const pure = new PaperTradePermissionMemory();
    const q = queryOf();
    assert.equal(refusePaperTradePermission(withLedger(newRecord), q, 5_000, pure), null);
    assert.equal(refusePaperTradePermission({ ...auth(), latestPermit: () => kit.testRecord(q, { generatedAt: "1970-01-01T00:00:02.000Z", evidenceReferences: ["test-evidence-2"] }), isLatest: () => true }, q, 5_000, pure), REPLAYED, "same time, different record");
    const fresh = build(withLedger(newRecord)).processTick(continuationTick());
    assert.equal(fresh.status, "FILLED");
    assert.equal(repository.loadFills().length, fillsBefore + 1);
  } finally {
    try { repository.close(); } catch {}
    try { db.close(); } catch {}
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("a risk-reducing cancel of a superseded working order does not need a permit (no new exposure)", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, feeRate: 0, readP0State: () => ({ openP0: false }) });
  const risk = { evaluate: () => Object.freeze({ status: "ALLOW", reasonCodes: Object.freeze([]) }) };
  const open = new CloudPaperExecutionBoundary({ loop, riskGate: risk, readP0State: () => ({ openP0: false }), tradePermissionAuthority: auth() });
  assert.equal(open.processTick(openTick()).reason, "PAPER_STRATEGY_PARTIALLY_FILLED");
  const none = new CloudPaperExecutionBoundary({ loop, riskGate: risk, readP0State: () => ({ openP0: false }), tradePermissionAuthority: NO_PAPER_TRADE_PERMISSION_AUTHORITY });
  const other = Object.freeze({ ...decision, paperCandidateBinding: Object.freeze({ ...candidateBinding, bindingFingerprintSha256: "9".repeat(64) }) });
  const cancelled = none.processTick(tick(2_200, 2_100, 50_000_000, [other], observedQuote(2_150, 0.02)));
  assert.notEqual(cancelled.status, "BLOCKED");
  assert.equal((cancelled.state.workingOrders ?? []).length, 0);
});

test("the pure check: only a complete, matching, unexpired, engine-reproducible, store-confirmed PERMIT passes", () => {
  const q = { decisionId: "d", strategyId: "s", market: "KRW-BTC" };
  assert.equal(refusePaperTradePermission(auth(), q, 5), null);
  assert.equal(refusePaperTradePermission(auth(), q, Number.NaN), UNVERIFIABLE);
  assert.equal(refusePaperTradePermission(undefined, q, 5), UNVERIFIABLE);
  assert.equal(refusePaperTradePermission(auth({}, { edit: (r) => ({ input: r.input, permit: { ...r.permit, expiresAt: "garbage" } }) }), q, 5), TAMPERED);
  assert.equal(refusePaperTradePermission(auth({}, { edit: (r) => ({ input: null, permit: r.permit }) }), q, 5), INCOMPLETE);
  assert.equal(refusePaperTradePermission(auth({}, { evidenceExists: () => 1 }), q, 5), UNVERIFIED, "only a literal true confirms the evidence");
});

test("source: both strategy paths ask for the permit before the risk gate AND again before the simulator; the runtime uses the no-permit authority; the test kit is never imported by production code", () => {
  const boundary = fs.readFileSync(path.join(__dirname, "..", "apps/cloud/src/cloudPaperExecutionBoundary.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(boundary.split("refusePaperTradePermission(this.options.tradePermissionAuthority").length - 1, 4);
  const calls = [...boundary.matchAll(/refusePaperTradePermission\(this\.options/g)].map((m) => m.index);
  const strategyRisk = [...boundary.matchAll(/path: "STRATEGY"/g)].map((m) => m.index);
  const simulator = [boundary.indexOf("this.options.loop.advanceStrategyWorkingOrder(working.id, tick)"), boundary.indexOf("this.options.loop.processTick(Object.freeze({")];
  assert.equal(strategyRisk.length, 2);
  // continuation: [0] before risk, [1] after risk and before advance; new order: [2] before risk, [3] after risk and before processTick
  assert.ok(calls[0] < strategyRisk[0] && strategyRisk[0] < calls[1] && calls[1] < simulator[0], "continuation: permit, risk, permit, simulator");
  assert.ok(calls[2] < strategyRisk[1] && strategyRisk[1] < calls[3] && calls[3] < simulator[1], "new order: permit, risk, permit, simulator");
  const runtime = fs.readFileSync(path.join(__dirname, "..", "apps/cloud/src/runtime.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.match(runtime, /tradePermissionAuthority: PaperTradePermissionAuthority = NO_PAPER_TRADE_PERMISSION_AUTHORITY/, "the runtime default has no permit");
  assert.match(runtime, /new CloudPaperExecutionBoundary\(\{[^}]*tradePermissionAuthority \}\)/);
  const production = fs.readFileSync(path.join(__dirname, "..", "apps/cloud/src/closedLearningProductionRuntime.ts"), "utf8");
  assert.doesNotMatch(production, /tradePermissionAuthority/, "the production composition never supplies a permit source");
  const offenders = [];
  const walk = (dir) => { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); if (fs.statSync(p).isDirectory()) { if (n !== "node_modules" && n !== "testing") walk(p); } else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n) && fs.readFileSync(p, "utf8").includes("paperTradePermissionTestKit")) offenders.push(p); } };
  walk(path.join(__dirname, "..", "apps"));
  assert.deepEqual(offenders, [], "no production source imports the test kit");
});
