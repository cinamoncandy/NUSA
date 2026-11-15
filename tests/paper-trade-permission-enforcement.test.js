"use strict";
// Canonical TradePermission enforcement at the Cloud PAPER execution boundary (#3108). A strategy order, new or continued,
// reaches the simulator only with an unexpired PERMIT bound to its intent, strategy, market, policy version and
// probability-model version, with complete gate evidence. Everything else is refused before the risk gate and the simulator.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { CloudPaperExecutionBoundary } = require("../dist/apps/cloud/src/cloudPaperExecutionBoundary.js");
const { NO_PAPER_TRADE_PERMISSION_AUTHORITY, refusePaperTradePermission } = require("../dist/apps/cloud/src/paperTradePermissionGuard.js");
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


const authorityWith = (permitFor, versions = {}) => ({
  policyVersion: versions.policyVersion ?? kit.TEST_POLICY_VERSION,
  probabilityModelVersion: versions.probabilityModelVersion ?? kit.TEST_MODEL_VERSION,
  latestPermit: permitFor,
});

function rig(authority) {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, feeRate: 0, readP0State: () => ({ openP0: false }) });
  let riskCalls = 0;
  const queries = [];
  const wrapped = authority == null ? authority : { ...authority, latestPermit: (q) => { queries.push(q); return authority.latestPermit(q); } };
  const boundary = new CloudPaperExecutionBoundary({
    loop,
    tradePermissionAuthority: wrapped,
    riskGate: { evaluate() { riskCalls += 1; return Object.freeze({ status: "ALLOW", reasonCodes: Object.freeze([]) }); } },
    readP0State: () => ({ openP0: false }),
  });
  return { loop, boundary, riskCalls: () => riskCalls, queries };
}

const refusedNewOrder = (label, authority, reason) => test(`new strategy order is refused: ${label}`, () => {
  const r = rig(authority);
  const before = JSON.stringify(r.loop.snapshot());
  const result = r.boundary.processTick(tick(2_000, 1_500, 50_000_000, [decision], observedQuote(1_900, 0.005)));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, reason);
  assert.equal(r.riskCalls(), 0, "the risk gate is not even asked");
  assert.equal(JSON.stringify(r.loop.snapshot()), before, "no order, fill, ledger or state change");
  assert.equal(r.loop.snapshot().orders.length, 0);
  assert.equal((r.loop.snapshot().workingOrders ?? []).length, 0);
});

refusedNewOrder("no authority configured (production default)", NO_PAPER_TRADE_PERMISSION_AUTHORITY, "PAPER_TRADE_PERMISSION_ABSENT");
refusedNewOrder("authority object missing", undefined, "PAPER_TRADE_PERMISSION_UNVERIFIABLE");
refusedNewOrder("authority throws", authorityWith(() => { throw new Error("boom"); }), "PAPER_TRADE_PERMISSION_UNVERIFIABLE");
refusedNewOrder("no permit for the query", authorityWith(() => null), "PAPER_TRADE_PERMISSION_ABSENT");
refusedNewOrder("empty policy version", authorityWith((q) => kit.testPermit(q), { policyVersion: " " }), "PAPER_TRADE_PERMISSION_UNVERIFIABLE");
refusedNewOrder("explicit REJECT (governance not approved)", authorityWith((q) => kit.testPermit(q, { governanceApproved: false })), "PAPER_TRADE_PERMISSION_NOT_PERMIT");
refusedNewOrder("explicit REJECT (kill switch)", authorityWith((q) => kit.testPermit(q, { killSwitchActive: true })), "PAPER_TRADE_PERMISSION_NOT_PERMIT");
refusedNewOrder("expired", authorityWith((q) => kit.testPermit(q, { policy: { permissionTtlMs: 1_000 } })), "PAPER_TRADE_PERMISSION_EXPIRED");
refusedNewOrder("expires exactly now", authorityWith((q) => kit.testPermit(q, { policy: { permissionTtlMs: 2_000 } })), "PAPER_TRADE_PERMISSION_EXPIRED");
refusedNewOrder("generated in the future", authorityWith((q) => kit.testPermit(q, { generatedAt: "2050-01-01T00:00:00.000Z" })), "PAPER_TRADE_PERMISSION_INVALID_TIME");
refusedNewOrder("other decision", authorityWith((q) => kit.testPermit(q, { decisionId: "paper-intent:other" })), "PAPER_TRADE_PERMISSION_MISMATCH");
refusedNewOrder("other strategy", authorityWith((q) => kit.testPermit(q, { strategyId: "other-candidate" })), "PAPER_TRADE_PERMISSION_MISMATCH");
refusedNewOrder("other market", authorityWith((q) => kit.testPermit(q, { market: "KRW-ETH" })), "PAPER_TRADE_PERMISSION_MISMATCH");
refusedNewOrder("other policy version", authorityWith((q) => kit.testPermit(q, { policy: { policyVersion: "old-policy" } })), "PAPER_TRADE_PERMISSION_MISMATCH");
refusedNewOrder("other probability model version", authorityWith((q) => kit.testPermit(q, { probability: { modelVersion: "old-model" } })), "PAPER_TRADE_PERMISSION_MISMATCH");
refusedNewOrder("no evidence references", authorityWith((q) => ({ ...kit.testPermit(q), evidenceReferences: [] })), "PAPER_TRADE_PERMISSION_EVIDENCE_INCOMPLETE");
refusedNewOrder("a gate missing from the evidence", authorityWith((q) => { const p = kit.testPermit(q); return { ...p, gates: p.gates.slice(1), passedGates: p.passedGates.slice(1) }; }), "PAPER_TRADE_PERMISSION_EVIDENCE_INCOMPLETE");
refusedNewOrder("a failed gate listed on a PERMIT", authorityWith((q) => ({ ...kit.testPermit(q), failedGates: ["GOVERNANCE"] })), "PAPER_TRADE_PERMISSION_EVIDENCE_INCOMPLETE");
refusedNewOrder("a gate recorded as not passed on a PERMIT", authorityWith((q) => { const p = kit.testPermit(q); return { ...p, gates: p.gates.map((g, i) => (i === 3 ? { ...g, passed: false } : g)) }; }), "PAPER_TRADE_PERMISSION_EVIDENCE_INCOMPLETE");

test("a matching unexpired PERMIT reaches the existing path unchanged; the query carries the intent identity, candidate and market", () => {
  const r = rig(authorityWith((q) => kit.testPermit(q)));
  const first = r.boundary.processTick(tick(2_000, 1_500, 50_000_000, [decision], observedQuote(1_900, 0.005)));
  assert.equal(first.status, "WAIT");
  assert.equal(first.reason, "PAPER_STRATEGY_PARTIALLY_FILLED");
  assert.equal(r.riskCalls(), 1);
  assert.equal(r.queries.length, 1);
  assert.match(r.queries[0].decisionId, /^paper-intent:[a-f0-9]{64}$/);
  assert.equal(r.queries[0].strategyId, "sma-5-20");
  assert.equal(r.queries[0].market, "KRW-BTC");
  assert.equal(first.state.workingOrders[0].idempotencyKey, r.queries[0].decisionId, "the permit identity is the order identity");
});

test("a continued strategy working order needs a permit on every tick (restored or not)", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, feeRate: 0, readP0State: () => ({ openP0: false }) });
  const calls = { risk: 0 };
  const build = (authority) => new CloudPaperExecutionBoundary({
    loop, tradePermissionAuthority: authority, readP0State: () => ({ openP0: false }),
    riskGate: { evaluate() { calls.risk += 1; return Object.freeze({ status: "ALLOW", reasonCodes: Object.freeze([]) }); } },
  });
  const good = authorityWith((q) => kit.testPermit(q));
  assert.equal(build(good).processTick(tick(2_000, 1_500, 50_000_000, [decision], observedQuote(1_900, 0.005))).reason, "PAPER_STRATEGY_PARTIALLY_FILLED");
  const workingBefore = JSON.stringify(loop.snapshot());
  const riskBefore = calls.risk;
  const continuation = () => tick(2_200, 2_100, 50_000_000, [], observedQuote(2_150, 0.02));
  const cases = [
    ["no authority", NO_PAPER_TRADE_PERMISSION_AUTHORITY, "PAPER_TRADE_PERMISSION_ABSENT"],
    ["REJECT", authorityWith((q) => kit.testPermit(q, { governanceApproved: false })), "PAPER_TRADE_PERMISSION_NOT_PERMIT"],
    ["expired", authorityWith((q) => kit.testPermit(q, { policy: { permissionTtlMs: 1_000 } })), "PAPER_TRADE_PERMISSION_EXPIRED"],
    ["other strategy", authorityWith((q) => kit.testPermit(q, { strategyId: "x" })), "PAPER_TRADE_PERMISSION_MISMATCH"],
    ["other decision", authorityWith((q) => kit.testPermit(q, { decisionId: "paper-intent:x" })), "PAPER_TRADE_PERMISSION_MISMATCH"],
    ["other model", authorityWith((q) => kit.testPermit(q, { probability: { modelVersion: "m" } })), "PAPER_TRADE_PERMISSION_MISMATCH"],
    ["no evidence", authorityWith((q) => ({ ...kit.testPermit(q), evidenceReferences: [] })), "PAPER_TRADE_PERMISSION_EVIDENCE_INCOMPLETE"],
    ["throws", authorityWith(() => { throw new Error("x"); }), "PAPER_TRADE_PERMISSION_UNVERIFIABLE"],
  ];
  for (const [label, authority, reason] of cases) {
    const result = build(authority).processTick(continuation());
    assert.equal(result.status, "BLOCKED", label);
    assert.equal(result.reason, reason, label);
    assert.equal(JSON.stringify(loop.snapshot()), workingBefore, `${label}: the working order and ledger are untouched`);
    assert.equal(calls.risk, riskBefore, `${label}: the risk gate is not asked`);
  }
  const done = build(good).processTick(continuation());
  assert.equal(done.status, "FILLED");
});

test("a risk-reducing cancel of a superseded working order does not need a permit (no new exposure)", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, feeRate: 0, readP0State: () => ({ openP0: false }) });
  const risk = { evaluate: () => Object.freeze({ status: "ALLOW", reasonCodes: Object.freeze([]) }) };
  const open = new CloudPaperExecutionBoundary({ loop, riskGate: risk, readP0State: () => ({ openP0: false }), tradePermissionAuthority: authorityWith((q) => kit.testPermit(q)) });
  assert.equal(open.processTick(tick(2_000, 1_500, 50_000_000, [decision], observedQuote(1_900, 0.005))).reason, "PAPER_STRATEGY_PARTIALLY_FILLED");
  const none = new CloudPaperExecutionBoundary({ loop, riskGate: risk, readP0State: () => ({ openP0: false }), tradePermissionAuthority: NO_PAPER_TRADE_PERMISSION_AUTHORITY });
  const other = Object.freeze({ ...decision, paperCandidateBinding: Object.freeze({ ...candidateBinding, bindingFingerprintSha256: "9".repeat(64) }) });
  const cancelled = none.processTick(tick(2_200, 2_100, 50_000_000, [other], observedQuote(2_150, 0.02)));
  assert.notEqual(cancelled.status, "BLOCKED");
  assert.equal((cancelled.state.workingOrders ?? []).length, 0);
});

test("the pure check: every refusal code, and only a complete matching unexpired PERMIT passes", () => {
  const q = { decisionId: "d", strategyId: "s", market: "KRW-BTC" };
  const ok = authorityWith(() => kit.testPermit(q));
  assert.equal(refusePaperTradePermission(ok, q, 5), null);
  assert.equal(refusePaperTradePermission(ok, q, Number.NaN), "PAPER_TRADE_PERMISSION_UNVERIFIABLE");
  assert.equal(refusePaperTradePermission(undefined, q, 5), "PAPER_TRADE_PERMISSION_UNVERIFIABLE");
  assert.equal(refusePaperTradePermission(authorityWith(() => ({ ...kit.testPermit(q), expiresAt: "garbage" })), q, 5), "PAPER_TRADE_PERMISSION_INVALID_TIME");
  assert.equal(refusePaperTradePermission(authorityWith(() => ({ ...kit.testPermit(q), expiresAt: kit.testPermit(q).generatedAt })), q, 5), "PAPER_TRADE_PERMISSION_INVALID_TIME");
});

test("source: both strategy paths ask for the permit before the risk gate; the runtime uses the no-permit authority; the test kit is never imported by production code", () => {
  const boundary = fs.readFileSync(path.join(__dirname, "..", "apps/cloud/src/cloudPaperExecutionBoundary.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(boundary.split("refusePaperTradePermission(this.options.tradePermissionAuthority").length - 1, 2);
  const strategyRiskCalls = [...boundary.matchAll(/path: "STRATEGY"/g)].map((m) => m.index);
  const permitCalls = [...boundary.matchAll(/refusePaperTradePermission\(this\.options/g)].map((m) => m.index);
  assert.equal(strategyRiskCalls.length, 2);
  for (let i = 0; i < 2; i += 1) assert.ok(permitCalls[i] < strategyRiskCalls[i], `permit check ${i} precedes the STRATEGY risk evaluation`);
  const runtime = fs.readFileSync(path.join(__dirname, "..", "apps/cloud/src/runtime.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.match(runtime, /tradePermissionAuthority: NO_PAPER_TRADE_PERMISSION_AUTHORITY/);
  const srcRoot = path.join(__dirname, "..", "apps");
  const offenders = [];
  const walk = (dir) => { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); if (fs.statSync(p).isDirectory()) { if (n !== "node_modules" && n !== "testing") walk(p); } else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n) && fs.readFileSync(p, "utf8").includes("paperTradePermissionTestKit")) offenders.push(p); } };
  walk(srcRoot);
  assert.deepEqual(offenders, [], "no production source imports the test kit");
});
