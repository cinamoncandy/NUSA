const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runStrategyResearchScorecard, PROHIBITED_ALWAYS } = require("../scripts/lib/strategy-research-promotion-gate-runner.js");

const dir = path.join(__dirname, "fixtures", "strategy-promotion-gate");
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));
const decide = (name) => runStrategyResearchScorecard(load(name)).researchDecision;
const datasetMetrics = (request) => request.manifest.evidence.find((entry) => entry.evidenceType === "DATASET_QUALITY").metrics;

test("each fixture reaches its intended gate decision", () => {
  assert.equal(decide("promote-review"), "PROMOTE_TO_EXTENDED_PAPER_REVIEW");
  assert.equal(decide("synthetic-only"), "CONTINUE_RESEARCH");
  assert.equal(decide("strong-research-no-paper-safety"), "CONTINUE_RESEARCH");
  assert.equal(decide("revise-strategy"), "REVISE_STRATEGY");
  assert.equal(decide("reject-strategy"), "REJECT_STRATEGY");
  assert.equal(decide("hold-missing-evidence"), "INSUFFICIENT_EVIDENCE");
  assert.equal(decide("insufficient-sample"), "INSUFFICIENT_EVIDENCE");
  assert.equal(decide("look-ahead-blocker"), "INVALID");
  assert.equal(decide("invalid-verifier"), "INVALID");
  assert.equal(decide("operational-safety-failure"), "INVALID");
});

test("a failed independent verification cannot be downgraded to a warning", () => {
  const result = runStrategyResearchScorecard(load("invalid-verifier"));
  assert.equal(result.researchDecision, "INVALID");
  assert.ok(result.blockers.some((blocker) => blocker.detail.includes("INVALID")));
});

test("a breached operational safety boundary is a hard stop, not a hold", () => {
  const result = runStrategyResearchScorecard(load("operational-safety-failure"));
  assert.equal(result.researchDecision, "INVALID");
  assert.ok(result.decisionReasons.some((reason) => reason.includes("hard stop")));
});

test("one structural failure revises, two reject", () => {
  const revise = runStrategyResearchScorecard(load("revise-strategy"));
  const reject = runStrategyResearchScorecard(load("reject-strategy"));
  const failing = (result) => result.dimensions.filter((d) => ["D-003", "D-004", "D-005", "D-006", "D-007"].includes(d.id) && d.status === "FAIL");
  assert.equal(failing(revise).length, 1);
  assert.ok(failing(reject).length >= 2);
  assert.equal(revise.researchDecision, "REVISE_STRATEGY");
  assert.equal(reject.researchDecision, "REJECT_STRATEGY");
});

test("missing evidence can never reach a promotion decision", () => {
  const result = runStrategyResearchScorecard(load("hold-missing-evidence"));
  assert.equal(result.researchDecision, "INSUFFICIENT_EVIDENCE");
  assert.ok(result.evidenceManifest.some((entry) => !entry.present));
});

test("synthetic evidence alone can never promote, however good the numbers are", () => {
  const result = runStrategyResearchScorecard(load("synthetic-only"));
  assert.notEqual(result.researchDecision, "PROMOTE_TO_EXTENDED_PAPER_REVIEW");
  assert.ok(result.blockers.some((blocker) => blocker.detail.includes("synthetic")));
});

test("missing selection-bias correction evidence fails closed", () => {
  const request = load("promote-review");
  delete datasetMetrics(request).selectionBiasControlStatus;
  const result = runStrategyResearchScorecard(request);
  assert.notEqual(result.researchDecision, "PROMOTE_TO_EXTENDED_PAPER_REVIEW");
  assert.equal(result.dimensions.find((dimension) => dimension.id === "D-001").status, "INCONCLUSIVE");
  assert.ok(result.blockers.some((blocker) => blocker.detail.includes("selection-bias correction")));
});

test("unverified survivorship-bias correction evidence fails closed", () => {
  const request = load("promote-review");
  datasetMetrics(request).survivorshipBiasControlStatus = "UNVERIFIED";
  const result = runStrategyResearchScorecard(request);
  assert.notEqual(result.researchDecision, "PROMOTE_TO_EXTENDED_PAPER_REVIEW");
  assert.equal(result.dimensions.find((dimension) => dimension.id === "D-001").status, "INCONCLUSIVE");
  assert.ok(result.blockers.some((blocker) => blocker.detail.includes("survivorship-bias correction")));
});

test("verified selection and survivorship controls keep promotion possible", () => {
  const result = runStrategyResearchScorecard(load("promote-review"));
  const dataIntegrity = result.dimensions.find((dimension) => dimension.id === "D-001");
  assert.equal(dataIntegrity.metrics.selectionBiasControlStatus, "VERIFIED");
  assert.equal(dataIntegrity.metrics.survivorshipBiasControlStatus, "VERIFIED");
  assert.equal(result.researchDecision, "PROMOTE_TO_EXTENDED_PAPER_REVIEW");
});

test("technical execution status and research decision are separate fields", () => {
  const result = runStrategyResearchScorecard(load("reject-strategy"));
  assert.equal(result.executionStatus, "PASS");
  assert.equal(result.researchDecision, "REJECT_STRATEGY");
});

test("no single numeric total score is produced", () => {
  const result = runStrategyResearchScorecard(load("promote-review"));
  assert.equal(Object.prototype.hasOwnProperty.call(result, "totalScore"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "score"), false);
});

test("prohibited actions are unconditional and present in every decision", () => {
  for (const name of ["promote-review", "reject-strategy", "synthetic-only", "look-ahead-blocker"]) {
    const result = runStrategyResearchScorecard(load(name));
    for (const prohibited of PROHIBITED_ALWAYS) assert.ok(result.prohibitedActions.includes(prohibited), `${name} lost: ${prohibited}`);
  }
});

test("an INVALID or REJECT decision additionally prohibits reusing the results", () => {
  for (const name of ["look-ahead-blocker", "reject-strategy"]) {
    const result = runStrategyResearchScorecard(load(name));
    assert.ok(result.prohibitedActions.includes("Reuse the existing research results"));
    assert.ok(result.prohibitedActions.includes("Publish any profitability claim"));
  }
});

test("even PROMOTE only permits review preparation, never a Live or Ready transition", () => {
  const result = runStrategyResearchScorecard(load("promote-review"));
  assert.ok(result.permittedNextActions.includes("Request owner safety review"));
  for (const action of result.permittedNextActions) {
    assert.equal(/live|real order|credential|merge|ready/i.test(action), false, `permitted action must stay research-scoped: ${action}`);
  }
});

test("owner review starts PENDING and the scorecard never approves itself", () => {
  const result = runStrategyResearchScorecard(load("promote-review"));
  assert.equal(result.ownerReview.status, "PENDING");
  assert.equal(result.ownerReview.approvedBy, null);
  assert.equal(result.ownerReview.approvedAt, null);
});

test("limitations are always disclosed, including on the promotable fixture", () => {
  const result = runStrategyResearchScorecard(load("promote-review"));
  assert.ok(result.limitations.length >= 5);
  assert.ok(result.limitations.some((text) => text.includes("Live Trading")));
  assert.ok(result.limitations.some((text) => text.includes("survivorship")));
});

test("the current repository state honestly reports INSUFFICIENT_EVIDENCE", () => {
  const result = runStrategyResearchScorecard(load("current-repository-state"));
  assert.equal(result.executionStatus, "PASS");
  assert.equal(result.researchDecision, "INSUFFICIENT_EVIDENCE");
});
