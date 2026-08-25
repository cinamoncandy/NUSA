const test = require("node:test");
const assert = require("node:assert/strict");
const { formatEvidenceChecklist } = require("../dist/apps/desktop/src/evidence/evidenceChecklist.js");

const notEvaluated = Object.freeze({
  database: "not evaluated",
  observedSessions: { current: 0, required: 20 },
  completedOrders: { current: 0, required: 50 },
  representedRegimes: { current: 0, required: 3 },
  restartRecoveryPasses: { current: 0, required: 3 },
  duplicateChecks: { current: 0, required: 10 },
  faultScenarios: "NOT_EVALUATED",
  walkForward: "NOT_EVALUATED",
  costStress: "NOT_EVALUATED",
  monteCarlo: "NOT_EVALUATED",
  integrity: "NOT_EVALUATED",
  bundle: "NOT_EVALUATED",
  ownerReview: "NOT_COMPLETED",
  releaseStatus: "BLOCKED",
  blockingReasons: Object.freeze(["DATABASE_NOT_EVALUATED", "OWNER_REVIEW_REQUIRED"])
});

test("renders unchecked boxes and blocking reasons for an unevaluated database", () => {
  const output = formatEvidenceChecklist(notEvaluated);
  assert.match(output, /\[ \] Observed sessions\s+0 \/ 20/);
  assert.match(output, /\[ \] Completed orders\s+0 \/ 50/);
  assert.match(output, /Database: not evaluated/);
  assert.match(output, /NOT_EVALUATED/);
  assert.match(output, /Release status: BLOCKED/);
  assert.match(output, /- DATABASE_NOT_EVALUATED/);
  assert.match(output, /- OWNER_REVIEW_REQUIRED/);
  assert.doesNotMatch(output, /All required evidence rows are complete/);
});

test("checks a row's box once its current count meets the required target", () => {
  const partial = { ...notEvaluated, database: "evaluated", observedSessions: { current: 20, required: 20 }, completedOrders: { current: 51, required: 50 } };
  const output = formatEvidenceChecklist(partial);
  assert.match(output, /\[x\] Observed sessions\s+20 \/ 20/);
  assert.match(output, /\[x\] Completed orders\s+ 51 \/ 50/);
  assert.match(output, /\[ \] Represented regimes\s+0 \/ 3/);
});

test("lists passed fault scenarios and checks a PASS research report", () => {
  const partial = { ...notEvaluated, faultScenarios: ["KILL_SWITCH", "WEBSOCKET_DISCONNECT"], walkForward: "PASS" };
  const output = formatEvidenceChecklist(partial);
  assert.match(output, /- KILL_SWITCH/);
  assert.match(output, /- WEBSOCKET_DISCONNECT/);
  assert.match(output, /\[x\] Walk-Forward\s+PASS/);
  assert.match(output, /\[ \] Cost Stress\s+NOT_EVALUATED/);
});

test("renders an approved release status without a blocking-reasons section", () => {
  const approved = {
    database: "evaluated",
    observedSessions: { current: 20, required: 20 },
    completedOrders: { current: 50, required: 50 },
    representedRegimes: { current: 3, required: 3 },
    restartRecoveryPasses: { current: 3, required: 3 },
    duplicateChecks: { current: 10, required: 10 },
    faultScenarios: ["KILL_SWITCH", "PERSISTENCE_FAILURE", "WEBSOCKET_DISCONNECT"],
    walkForward: "PASS",
    costStress: "PASS",
    monteCarlo: "PASS",
    integrity: "PASS",
    bundle: "PASS",
    ownerReview: "COMPLETED",
    releaseStatus: "APPROVED",
    blockingReasons: []
  };
  const output = formatEvidenceChecklist(approved);
  assert.match(output, /Release status: APPROVED/);
  assert.match(output, /All required evidence rows are complete and owner-reviewed\./);
  assert.doesNotMatch(output, /Blocking reasons:/);
});
