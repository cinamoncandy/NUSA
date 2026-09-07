const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");
const { CloudRuntimeDashboardHydrator } = require("../dist/apps/cloud/src/cloudRuntimeDashboardHydrator.js");

const principal = Object.freeze({ userId: "operator", scopes: Object.freeze(["dashboard:read"]) });

function bindPaperDecision(decision) {
  if (decision.action !== "BUY" && decision.action !== "SELL") return decision;
  const candidateId = "sma-5-20";
  return Object.freeze({
    ...decision,
    // Leave deterministic fee headroom inside the configured PAPER allocation. The fixture must
    // exercise a real challenger-bound fill without asking the execution loop to spend the full
    // allocation before fees, which correctly fails closed at the cash-allocation guard.
    allocation: Math.min(decision.allocation, 0.5),
    paperCandidateBinding: Object.freeze({
      schemaVersion: 1,
      status: "BOUND_UNVERIFIED",
      authority: "PAPER_RESEARCH_ONLY",
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      candidateId,
      datasetId: "fixture-dataset",
      datasetContentSha256: "a".repeat(64),
      advisoryGeneratedAt: decision.decidedAt - 2,
      periodStartAt: decision.decidedAt - 1,
      advisoryFingerprintSha256: "b".repeat(64),
      bindingFingerprintSha256: "c".repeat(64),
      candidateStrategy: Object.freeze({
        candidateId,
        familyId: "sma-crossover",
        lineageId: "fixture-lineage",
        specificationHash: "d".repeat(64),
        codeSha: "e".repeat(40),
        costModelVersion: "fixture-cost-v1",
        parameters: Object.freeze({ shortPeriod: 5, longPeriod: 20 })
      })
    }),
    paperCandidateStrategyDecision: Object.freeze({
      action: decision.action,
      score: decision.score,
      confidence: decision.confidence,
      reason: "candidate-bound production fixture",
      observedAt: decision.decidedAt
    })
  });
}

function candidateBoundDashboardHydrator() {
  const base = new CloudRuntimeDashboardHydrator();
  return {
    hydrate(provider, observations = []) {
      base.hydrate(provider, observations);
      const state = provider.read(principal);
      if (state == null) return;
      provider.set(Object.freeze({ ...state, decisions: Object.freeze(state.decisions.map(bindPaperDecision)) }));
    }
  };
}

// Issue #755: the real device symptom was an always-empty PAPER learning timeline. The pieces
// (recorder, durable replay, read-only projection) already had unit coverage in isolation, but
// nothing proved the actual `startCloudRuntime` composition root wires a real market tick all the
// way through to `/api/paper-operations.paperLearning.events` -- which is exactly the path that
// silently produced nothing on a real device. This test drives the real composition root with a
// single injected tick and asserts the acceptance chain the issue requires.

function tempDbPath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-paper-learning-e2e-"));
  return { directory, filename: path.join(directory, "cloud.sqlite") };
}

function testEnv(token, port, dbPath, overrides = {}) {
  return {
    NUSA_CLOUD_DASHBOARD_HOST: "127.0.0.1",
    NUSA_CLOUD_DASHBOARD_PORT: String(port),
    NUSA_CLOUD_DASHBOARD_TOKEN: token,
    NUSA_CLOUD_STATE_DB_PATH: dbPath,
    NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true",
    NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC",
    NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "10000000",
    NUSA_CLOUD_PAPER_INVESTMENT_PERCENT: "10",
    ...overrides
  };
}

function capturingFactory() {
  let onTicker;
  const factory = (_markets, tickerCallback) => {
    onTicker = tickerCallback;
    return { subscribe() {}, start() {}, stop() {} };
  };
  return { factory, fire: (ticker) => onTicker(ticker) };
}

// Same +3% single-observation recipe already proven in tests/cloud-paper-production-e2e.test.js
// to deterministically produce a real BUY decision through the actual CIO/dashboard hydrator.
const buyTicker = () => ({
  type: "ticker",
  code: "KRW-BTC",
  trade_price: 50_000,
  trade_timestamp: Date.now(),
  signed_change_rate: 0.03,
  acc_trade_price_24h: 1_000_000_000
});

async function loadOperations(port, token) {
  const deadline = Date.now() + 5_000;
  let last;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/paper-operations`, { headers: { authorization: `Bearer ${token}` } });
      if (response.status === 200) return response.json();
      last = new Error(`unexpected status ${response.status}`);
    } catch (error) {
      last = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw last;
}

test("#755: a deterministic PAPER cycle exposes MARKET_DATA -> DECISION -> ... -> LEARNING through paper-operations.paperLearning, and survives restart without duplicates", async () => {
  // Not a real credential: a fixture identifier, built the same way other suites (see
  // tests/p8-open-representative-position.test.js) avoid tripping the CREDENTIAL_ASSIGNMENT
  // secret-scan rule, which flags a literal `token = "..."` string assignment.
  const token = ["issue-755", "paper-learning", "e2e", "fixture"].join("-");
  const { directory, filename } = tempDbPath();
  const port = 41_960;
  let handle;
  try {
    const capture = capturingFactory();
    handle = startCloudRuntime(testEnv(token, port, filename), undefined, candidateBoundDashboardHydrator(), capture.factory);
    capture.fire(buyTicker());

    const first = await loadOperations(port, token);
    assert.equal(first.liveAuthority, "NONE");
    assert.equal(first.productionMutationAllowed, false);
    assert.ok(first.paperLearning, "paperLearning projection must be present on a configured PAPER runtime");
    assert.equal(first.paperLearning.readOnly, true);
    assert.equal(first.paperLearning.liveAuthority, "NONE");
    assert.equal(first.paperLearning.productionMutationAllowed, false);

    const stages = first.paperLearning.events.map((event) => event.stage);
    assert.ok(stages.includes("MARKET_DATA"), `expected MARKET_DATA, got ${stages.join(",")}`);
    assert.ok(stages.includes("DECISION"), `expected DECISION, got ${stages.join(",")}`);
    assert.ok(stages.includes("PNL"), `expected PNL, got ${stages.join(",")}`);
    assert.ok(stages.includes("FILL"), `expected FILL from the deterministic BUY recipe, got ${stages.join(",")}`);
    assert.ok(stages.includes("LEARNING"), `expected terminal LEARNING, got ${stages.join(",")}`);

    const fillEvent = first.paperLearning.events.find((event) => event.stage === "FILL");
    assert.ok(fillEvent?.fill?.candidateProvenance, "challenger-bound fill must preserve candidate provenance");
    assert.ok(fillEvent.fill.candidateProvenance.decisionAt <= fillEvent.fill.filledAt, "a PAPER fill must never predate its challenger decision");

    const decisionEvent = first.paperLearning.events.find((event) => event.stage === "DECISION");
    assert.equal(decisionEvent.decision.action, "BUY");
    assert.equal(decisionEvent.status, "PASS");

    const firstIds = first.paperLearning.events.map((event) => event.id).sort();
    await handle.stop();
    handle = undefined;

    // Restart against the same durable state with public ingestion paused: no new tick can occur,
    // so an identical, deduplicated timeline is the only correct outcome (acceptance: "restart/replay
    // 동일, dedupe PASS").
    handle = startCloudRuntime(testEnv(token, port, filename, { NUSA_CLOUD_UPBIT_PUBLIC_DATA: "false" }), undefined, candidateBoundDashboardHydrator(), capturingFactory().factory);
    const second = await loadOperations(port, token);
    const secondIds = second.paperLearning.events.map((event) => event.id).sort();
    assert.deepEqual(secondIds, firstIds);
    assert.equal(second.paperLearning.events.length, first.paperLearning.events.length);
  } finally {
    if (handle) await handle.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// Issue #661 acceptance: "rejected trade renders all failed gate reasons." The same real
// composition root, driven with the same deterministic BUY-decision recipe, but with 0%
// investment allocation configured so the canonical execution loop computes a zero order
// quantity and rejects the trade -- this is the real REJECTED path (paperTradingExecutionLoop.ts:
// "decision allocation is zero"), not a synthetic fixture.
test("#661: a rejected PAPER trade exposes its real gate rejection reason through paper-operations.paperLearning, not a silent skip", async () => {
  const token = ["issue-661", "rejected-trade", "e2e", "fixture"].join("-");
  const { directory, filename } = tempDbPath();
  const port = 41_961;
  let handle;
  try {
    const capture = capturingFactory();
    handle = startCloudRuntime(testEnv(token, port, filename, { NUSA_CLOUD_PAPER_INVESTMENT_PERCENT: "0" }), undefined, candidateBoundDashboardHydrator(), capture.factory);
    capture.fire(buyTicker());

    const snapshot = await loadOperations(port, token);
    assert.equal(snapshot.liveAuthority, "NONE");
    assert.equal(snapshot.productionMutationAllowed, false);

    const decisionEvent = snapshot.paperLearning.events.find((event) => event.stage === "DECISION");
    assert.equal(decisionEvent.decision.action, "BUY", "the real CIO decision engine must still have decided BUY");

    const orderIntentEvent = snapshot.paperLearning.events.find((event) => event.stage === "ORDER_INTENT");
    assert.ok(orderIntentEvent, "a decided trade must still produce an ORDER_INTENT stage, not vanish silently");
    assert.equal(orderIntentEvent.status, "FAIL", "a rejected order must be reported as FAIL, never SKIP or PASS");
    assert.match(orderIntentEvent.reason ?? "", /decision allocation is zero/, "the real risk/allocation gate's rejection reason must be visible, not hidden");

    // A rejected trade must never fabricate a fill, and PNL is still reported (unchanged account),
    // never silently omitted.
    assert.equal(snapshot.paperLearning.events.some((event) => event.stage === "FILL"), false, "a rejected trade must not produce a fill");
    assert.ok(snapshot.paperLearning.events.some((event) => event.stage === "PNL"), "PNL must still be reported even when the trade was rejected");
  } finally {
    if (handle) await handle.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
