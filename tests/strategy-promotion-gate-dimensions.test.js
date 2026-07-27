const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runStrategyResearchScorecard, DIMENSIONS } = require("../scripts/lib/strategy-research-promotion-gate-runner.js");

const dir = path.join(__dirname, "fixtures", "strategy-promotion-gate");
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));
const dim = (result, id) => result.dimensions.find((d) => d.id === id);

test("exactly ten dimensions are evaluated", () => {
  assert.equal(DIMENSIONS.length, 10);
  assert.equal(runStrategyResearchScorecard(load("promote-review")).dimensions.length, 10);
});

test("strong real evidence yields STRONG data and backtest integrity", () => {
  const result = runStrategyResearchScorecard(load("promote-review"));
  assert.equal(dim(result, "D-001").status, "STRONG");
  assert.equal(dim(result, "D-002").status, "STRONG");
});

test("detected look-ahead makes backtest integrity FAIL and blocks everything", () => {
  const result = runStrategyResearchScorecard(load("look-ahead-blocker"));
  assert.equal(dim(result, "D-002").status, "FAIL");
  assert.equal(result.researchDecision, "INVALID");
});

test("a strategy negative at baseline cost makes cost resilience FAIL", () => {
  const result = runStrategyResearchScorecard(load("reject-strategy"));
  assert.equal(dim(result, "D-003").status, "FAIL");
});

test("missing purge/embargo downgrades out-of-sample and warns about leakage", () => {
  const request = load("promote-review");
  request.manifest.evidence = request.manifest.evidence.map((entry) =>
    entry.evidenceType === "WALK_FORWARD" ? { ...entry, metrics: { ...entry.metrics, purgeApplied: false, embargoApplied: false } } : entry);
  const result = runStrategyResearchScorecard(request);
  assert.equal(dim(result, "D-004").status, "WEAK");
  assert.ok(dim(result, "D-004").warnings.some((w) => w.includes("purge/embargo")));
});

test("too few out-of-sample windows makes that dimension INCONCLUSIVE", () => {
  const result = runStrategyResearchScorecard(load("insufficient-sample"));
  assert.equal(dim(result, "D-004").status, "INCONCLUSIVE");
});

test("plateau classification maps onto parameter robustness status", () => {
  assert.equal(dim(runStrategyResearchScorecard(load("promote-review")), "D-005").status, "STRONG");
  assert.equal(dim(runStrategyResearchScorecard(load("revise-strategy")), "D-005").status, "FAIL");
});

test("a broadly weak regime dependency makes regime robustness FAIL", () => {
  assert.equal(dim(runStrategyResearchScorecard(load("reject-strategy")), "D-006").status, "FAIL");
});

test("incomparable cross-market sizing forces that dimension INCONCLUSIVE", () => {
  const request = load("promote-review");
  request.manifest.evidence = request.manifest.evidence.map((entry) =>
    entry.evidenceType === "CROSS_MARKET_VALIDATION" ? { ...entry, metrics: { ...entry.metrics, sizingComparable: false } } : entry);
  const result = runStrategyResearchScorecard(request);
  assert.equal(dim(result, "D-007").status, "INCONCLUSIVE");
  assert.ok(dim(result, "D-007").warnings.some((w) => w.includes("sizing is not comparable")));
});

test("sample shortfalls are listed individually on the sample-sufficiency dimension", () => {
  const result = runStrategyResearchScorecard(load("insufficient-sample"));
  assert.equal(dim(result, "D-008").status, "INCONCLUSIVE");
  assert.ok(dim(result, "D-008").weaknesses.length >= 3);
});

test("a missing independent risk gateway keeps operational safety below ACCEPTABLE", () => {
  const result = runStrategyResearchScorecard(load("strong-research-no-paper-safety"));
  assert.equal(dim(result, "D-010").status, "INCONCLUSIVE");
  assert.ok(dim(result, "D-010").weaknesses.some((w) => w.includes("independent risk gateway")));
});

test("a discovered live-trading capability makes operational safety FAIL", () => {
  const result = runStrategyResearchScorecard(load("operational-safety-failure"));
  assert.equal(dim(result, "D-010").status, "FAIL");
  assert.ok(dim(result, "D-010").blockers.some((b) => b.includes("live-trading capability")));
});

test("synthetic evidence downgrades market-performance dimensions but not implementation ones", () => {
  const result = runStrategyResearchScorecard(load("synthetic-only"));
  for (const id of ["D-001", "D-003", "D-004", "D-005", "D-006", "D-007", "D-009"]) {
    assert.ok(!["STRONG", "ACCEPTABLE"].includes(dim(result, id).status), `${id} must not be promotable on synthetic evidence`);
  }
  // Backtest integrity and operational safety are properties of the code, so synthetic
  // candles do not invalidate them.
  assert.equal(dim(result, "D-002").status, "STRONG");
  assert.equal(dim(result, "D-010").status, "ACCEPTABLE");
});

test("synthetic evidence never yields HIGH confidence", () => {
  const result = runStrategyResearchScorecard(load("synthetic-only"));
  for (const dimension of result.dimensions) assert.notEqual(dimension.confidence, "HIGH");
});

test("confidence reflects evidence quality, not how good the numbers look", () => {
  const strong = runStrategyResearchScorecard(load("promote-review"));
  assert.equal(dim(strong, "D-004").confidence, "HIGH");
  const thin = runStrategyResearchScorecard(load("insufficient-sample"));
  assert.equal(dim(thin, "D-004").confidence, "MEDIUM");
});
