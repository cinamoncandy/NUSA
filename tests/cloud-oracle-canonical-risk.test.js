const test = require("node:test");
const assert = require("node:assert/strict");
const { OraclePaperTradingExecutionLoop } = require("../dist/apps/cloud/src/oraclePaperTradingExecutionLoop.js");

const decision = (action = "BUY", decidedAt = 1_000) => Object.freeze({
  symbol: "KRW-BTC",
  action,
  confidence: 0.9,
  risk: "LOW",
  allocation: 0.5,
  leverage: 1,
  score: 0.7,
  reasons: Object.freeze(["test"]),
  decidedAt
});

const tick = (overrides = {}) => Object.freeze({
  now: 2_000,
  observedAt: 1_900,
  market: "KRW-BTC",
  price: 100,
  mode: "PAPER",
  killSwitchActive: false,
  tradingAllowed: true,
  overallHealth: "HEALTHY",
  decisions: Object.freeze([decision()]),
  ...overrides
});

const canonical = (status, reasonCodes = []) => Object.freeze({
  status,
  reasonCodes: Object.freeze(reasonCodes),
  reason: reasonCodes.join(",") || status,
  evaluatedAtMs: 2_000,
  decisionId: `decision-${status}`,
  productionMutationAllowed: false,
  dashboard: Object.freeze({ status, reasonCodes: Object.freeze(reasonCodes) })
});

test("Oracle PAPER does not mutate state when canonical risk blocks", () => {
  const seen = [];
  const loop = new OraclePaperTradingExecutionLoop({
    initialCapital: 1_000,
    readP0State: () => ({ openP0: false }),
    canonicalRiskGate: { evaluate(input) { seen.push(input); return canonical("BLOCKED", ["APPROVAL_MISSING"]); } }
  });
  const before = loop.snapshot();
  const result = loop.processTick(tick());
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "APPROVAL_MISSING");
  assert.deepEqual(loop.snapshot(), before);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].side, "BUY");
  assert.equal(seen[0].market, "KRW-BTC");
  assert.match(seen[0].idempotencyKey, /^paper:KRW-BTC:/);
});

test("Oracle PAPER fills only after an APPROVED zero-production-authority canonical decision", () => {
  const loop = new OraclePaperTradingExecutionLoop({
    initialCapital: 1_000,
    readP0State: () => ({ openP0: false }),
    canonicalRiskGate: { evaluate() { return canonical("APPROVED"); } }
  });
  const result = loop.processTick(tick());
  assert.equal(result.status, "FILLED");
  assert.equal(result.orders.length, 1);
  assert.equal(result.fills.length, 1);
  assert.equal(loop.snapshot().orders.length, 1);
});

test("Oracle PAPER rejects a malformed canonical decision that claims production mutation authority", () => {
  const loop = new OraclePaperTradingExecutionLoop({
    initialCapital: 1_000,
    readP0State: () => ({ openP0: false }),
    canonicalRiskGate: { evaluate() { return { ...canonical("APPROVED"), productionMutationAllowed: true }; } }
  });
  const result = loop.processTick(tick());
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "CANONICAL_RISK_INVALID");
  assert.equal(loop.snapshot().orders.length, 0);
});

test("durable P0 state blocks before canonical risk is consulted", () => {
  let evaluations = 0;
  const loop = new OraclePaperTradingExecutionLoop({
    initialCapital: 1_000,
    readP0State: () => ({ openP0: true }),
    canonicalRiskGate: { evaluate() { evaluations += 1; return canonical("APPROVED"); } }
  });
  const result = loop.processTick(tick());
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "OPEN_P0_ALERT");
  assert.equal(evaluations, 0);
  assert.equal(loop.snapshot().orders.length, 0);
});

test("multiple actionable decisions fail closed instead of sharing one canonical approval", () => {
  let evaluations = 0;
  const loop = new OraclePaperTradingExecutionLoop({
    initialCapital: 1_000,
    readP0State: () => ({ openP0: false }),
    canonicalRiskGate: { evaluate() { evaluations += 1; return canonical("APPROVED"); } }
  });
  const result = loop.processTick(tick({ decisions: Object.freeze([decision("BUY", 1_000), decision("BUY", 1_001)]) }));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "MULTIPLE_ACTIONABLE_DECISIONS_REQUIRE_REVIEW");
  assert.equal(evaluations, 0);
  assert.equal(loop.snapshot().orders.length, 0);
});
